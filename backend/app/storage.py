"""Private S3 object storage and thumbnail processing."""

from __future__ import annotations

import base64
import io
import re
import tempfile
import threading
import warnings
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from .config import Settings
from .models import ALLOWED_UPLOADS, PhotoItem, validate_photo_id

register_heif_opener()

THUMBNAIL_KEY_PATTERN = re.compile(
    r"^thumbnails/(?P<photo_id>r\d{13}-[0-9a-f]{32}\.(?:jpg|png|webp|heic|heif))\.webp$",
)
EXPECTED_IMAGE_FORMATS = {
    "jpg": {"JPEG"},
    "png": {"PNG"},
    "webp": {"WEBP"},
    "heic": {"HEIF", "HEIC"},
    "heif": {"HEIF", "HEIC"},
}
IMAGE_PROCESSING_LOCK = threading.Lock()


class StorageError(RuntimeError):
    """Safe base exception for storage failures."""


class PhotoNotFound(StorageError):
    pass


class InvalidUploadedObject(StorageError):
    pass


@dataclass(frozen=True)
class UploadTarget:
    url: str
    headers: dict[str, str]


@dataclass(frozen=True)
class PhotoPage:
    photos: list[PhotoItem]
    next_cursor: str | None
    total_count: int | None = None


class PhotoStorageProtocol(Protocol):
    def create_upload_target(
        self,
        photo_id: str,
        filename: str,
        content_type: str,
    ) -> UploadTarget: ...

    def complete_upload(self, photo_id: str) -> None: ...

    def list_photos(self, limit: int, cursor: str | None = None) -> PhotoPage: ...

    def create_download_url(self, photo_id: str, inline: bool = False) -> str: ...

    def stream_photo_archive(self, photo_ids: list[str]) -> Iterator[bytes]: ...

    def delete_photo(self, photo_id: str) -> int: ...

    def delete_photos(self, photo_ids: list[str]) -> int: ...

    def delete_all(self) -> int: ...


def original_key(photo_id: str) -> str:
    validate_photo_id(photo_id)
    return f"originals/{photo_id}"


def thumbnail_key(photo_id: str) -> str:
    validate_photo_id(photo_id)
    return f"thumbnails/{photo_id}.webp"


def encode_original_filename(filename: str) -> str:
    value = base64.urlsafe_b64encode(filename.encode("utf-8")).decode("ascii")
    return value.rstrip("=")


class _StreamingZipTarget:
    """Small non-seekable target that lets zipfile emit bounded chunks."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def write(self, data: bytes) -> int:
        self._buffer.extend(data)
        return len(data)

    def flush(self) -> None:
        pass

    def drain(self) -> bytes:
        chunk = bytes(self._buffer)
        self._buffer.clear()
        return chunk


class S3PhotoStorage:
    def __init__(self, settings: Settings, client: BaseClient | Any | None = None) -> None:
        self._settings = settings
        self._bucket = settings.s3_bucket
        self._client = client or boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key_id.get_secret_value(),
            aws_secret_access_key=settings.s3_secret_access_key.get_secret_value(),
            region_name=settings.s3_region,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": settings.s3_addressing_style},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    def create_upload_target(
        self,
        photo_id: str,
        filename: str,
        content_type: str,
    ) -> UploadTarget:
        key = original_key(photo_id)
        metadata = {
            "photo-id": photo_id,
            "original-name": encode_original_filename(filename),
        }
        url = self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket,
                "Key": key,
                "ContentType": content_type,
                "Metadata": metadata,
            },
            ExpiresIn=self._settings.signed_url_ttl_seconds,
            HttpMethod="PUT",
        )
        return UploadTarget(
            url=url,
            headers={
                "Content-Type": content_type,
                "x-amz-meta-photo-id": photo_id,
                "x-amz-meta-original-name": metadata["original-name"],
            },
        )

    def _head_original(self, photo_id: str) -> dict[str, Any]:
        try:
            return self._client.head_object(
                Bucket=self._bucket,
                Key=original_key(photo_id),
            )
        except ClientError as error:
            status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            code = error.response.get("Error", {}).get("Code")
            if status == 404 or code in {"404", "NoSuchKey", "NotFound"}:
                raise PhotoNotFound("photo not found") from error
            raise StorageError("object storage request failed") from error

    def _remove_invalid_original(self, photo_id: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=original_key(photo_id))
        except ClientError:
            pass

    def complete_upload(self, photo_id: str) -> None:
        extension = photo_id.rsplit(".", 1)[1]
        head = self._head_original(photo_id)
        content_length = int(head.get("ContentLength", 0))
        content_type = str(head.get("ContentType", "")).lower()
        metadata = head.get("Metadata", {})

        if metadata.get("photo-id") != photo_id:
            self._remove_invalid_original(photo_id)
            raise InvalidUploadedObject("upload metadata is invalid")
        if content_type not in ALLOWED_UPLOADS[extension]:
            self._remove_invalid_original(photo_id)
            raise InvalidUploadedObject("uploaded content type does not match the file")
        if content_length <= 0 or content_length > self._settings.max_upload_size:
            self._remove_invalid_original(photo_id)
            raise InvalidUploadedObject("uploaded file size is invalid")

        try:
            response = self._client.get_object(
                Bucket=self._bucket,
                Key=original_key(photo_id),
            )
            body = response["Body"]
            with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as source:
                bytes_read = 0
                while True:
                    chunk = body.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_read += len(chunk)
                    if bytes_read > self._settings.max_upload_size:
                        raise InvalidUploadedObject("uploaded file exceeds the size limit")
                    source.write(chunk)
                source.seek(0)
                thumbnail = self._render_thumbnail(source, extension)
        except InvalidUploadedObject:
            self._remove_invalid_original(photo_id)
            raise
        except ClientError as error:
            raise StorageError("object storage request failed") from error

        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=thumbnail_key(photo_id),
                Body=thumbnail,
                ContentType="image/webp",
                CacheControl="private, max-age=300",
                Metadata={"photo-id": photo_id},
            )
        except ClientError as error:
            raise StorageError("thumbnail could not be stored") from error

    def _render_thumbnail(self, source: Any, extension: str) -> bytes:
        with IMAGE_PROCESSING_LOCK:
            previous_limit = Image.MAX_IMAGE_PIXELS
            Image.MAX_IMAGE_PIXELS = self._settings.max_image_pixels
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(source) as probe:
                        actual_format = (probe.format or "").upper()
                        probe.verify()
                    if actual_format not in EXPECTED_IMAGE_FORMATS[extension]:
                        raise InvalidUploadedObject("file contents do not match the extension")

                    source.seek(0)
                    with Image.open(source) as image:
                        image.load()
                        image = ImageOps.exif_transpose(image)
                        image.thumbnail(
                            (
                                self._settings.thumbnail_max_dimension,
                                self._settings.thumbnail_max_dimension,
                            ),
                            Image.Resampling.LANCZOS,
                        )
                        if image.mode not in {"RGB", "RGBA"}:
                            image = image.convert("RGB")
                        output = io.BytesIO()
                        image.save(output, format="WEBP", quality=82, method=6)
                        return output.getvalue()
            except (
                UnidentifiedImageError,
                OSError,
                ValueError,
                Image.DecompressionBombWarning,
                Image.DecompressionBombError,
            ) as error:
                raise InvalidUploadedObject("uploaded file is not a supported image") from error
            finally:
                Image.MAX_IMAGE_PIXELS = previous_limit

    def list_photos(self, limit: int, cursor: str | None = None) -> PhotoPage:
        parameters: dict[str, Any] = {
            "Bucket": self._bucket,
            "Prefix": "thumbnails/",
            "MaxKeys": limit,
        }
        if cursor:
            parameters["StartAfter"] = thumbnail_key(cursor)

        try:
            response = self._client.list_objects_v2(**parameters)
            total_count = self._count_photos(response) if cursor is None else None
        except ClientError as error:
            raise StorageError("object storage request failed") from error

        photos: list[PhotoItem] = []
        for item in response.get("Contents", []):
            match = THUMBNAIL_KEY_PATTERN.fullmatch(item.get("Key", ""))
            if not match:
                continue
            photo_id = match.group("photo_id")
            url = self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": thumbnail_key(photo_id)},
                ExpiresIn=self._settings.signed_url_ttl_seconds,
                HttpMethod="GET",
            )
            uploaded_at = item.get("LastModified")
            if not isinstance(uploaded_at, datetime):
                continue
            photos.append(
                PhotoItem(
                    id=photo_id,
                    thumbnail_url=url,
                    uploaded_at=uploaded_at,
                ),
            )

        next_cursor = None
        if response.get("IsTruncated") and photos:
            next_cursor = photos[-1].id
        return PhotoPage(
            photos=photos,
            next_cursor=next_cursor,
            total_count=total_count,
        )

    def _count_photos(self, first_page: dict[str, Any]) -> int:
        response = first_page
        total = 0

        while True:
            total += sum(
                1
                for item in response.get("Contents", [])
                if THUMBNAIL_KEY_PATTERN.fullmatch(item.get("Key", ""))
            )
            if not response.get("IsTruncated"):
                return total

            continuation_token = response.get("NextContinuationToken")
            if not continuation_token:
                raise StorageError("object storage returned an incomplete photo listing")
            response = self._client.list_objects_v2(
                Bucket=self._bucket,
                Prefix="thumbnails/",
                MaxKeys=1000,
                ContinuationToken=continuation_token,
            )

    def create_download_url(self, photo_id: str, inline: bool = False) -> str:
        self._head_original(photo_id)
        extension = photo_id.rsplit(".", 1)[1]
        disposition = "inline" if inline else "attachment"
        return self._client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket,
                "Key": original_key(photo_id),
                "ResponseContentDisposition": (
                    f'{disposition}; filename="hochzeitsfoto.{extension}"'
                ),
            },
            ExpiresIn=self._settings.signed_url_ttl_seconds,
            HttpMethod="GET",
        )

    def stream_photo_archive(self, photo_ids: list[str]) -> Iterator[bytes]:
        # Check every object before response headers are sent. This avoids a partial
        # download when a selected photo disappeared between listing and download.
        for photo_id in photo_ids:
            self._head_original(photo_id)
        return self._iter_photo_archive(photo_ids)

    def _iter_photo_archive(self, photo_ids: list[str]) -> Iterator[bytes]:
        target = _StreamingZipTarget()
        try:
            with zipfile.ZipFile(target, mode="w", compression=zipfile.ZIP_STORED) as archive:
                for index, photo_id in enumerate(photo_ids, start=1):
                    extension = photo_id.rsplit(".", 1)[1]
                    filename = f"hochzeitsfoto-{index:03d}.{extension}"
                    try:
                        response = self._client.get_object(
                            Bucket=self._bucket,
                            Key=original_key(photo_id),
                        )
                        body = response["Body"]
                        with archive.open(filename, mode="w", force_zip64=True) as member:
                            while chunk := body.read(1024 * 1024):
                                member.write(chunk)
                                if output := target.drain():
                                    yield output
                    except ClientError as error:
                        raise StorageError("photo archive could not be created") from error
                    finally:
                        if "body" in locals() and callable(getattr(body, "close", None)):
                            body.close()
                        body = None
                    if output := target.drain():
                        yield output
            if output := target.drain():
                yield output
        except (OSError, zipfile.LargeZipFile) as error:
            raise StorageError("photo archive could not be created") from error

    def delete_photo(self, photo_id: str) -> int:
        return self.delete_photos([photo_id])

    def delete_photos(self, photo_ids: list[str]) -> int:
        for photo_id in photo_ids:
            self._head_original(photo_id)
        objects = [
            {"Key": key}
            for photo_id in photo_ids
            for key in (original_key(photo_id), thumbnail_key(photo_id))
        ]
        try:
            response = self._client.delete_objects(
                Bucket=self._bucket,
                Delete={"Objects": objects, "Quiet": True},
            )
        except ClientError as error:
            raise StorageError("photo could not be deleted") from error
        if response.get("Errors"):
            raise StorageError("one or more photos could not be deleted")
        return len(photo_ids)

    def delete_all(self) -> int:
        deleted_originals = self._delete_prefix("originals/")
        self._delete_prefix("thumbnails/")
        return deleted_originals

    def _delete_prefix(self, prefix: str) -> int:
        deleted = 0
        continuation_token: str | None = None
        while True:
            parameters: dict[str, Any] = {
                "Bucket": self._bucket,
                "Prefix": prefix,
                "MaxKeys": 1000,
            }
            if continuation_token:
                parameters["ContinuationToken"] = continuation_token
            try:
                response = self._client.list_objects_v2(**parameters)
                objects = [{"Key": item["Key"]} for item in response.get("Contents", [])]
                if objects:
                    self._client.delete_objects(
                        Bucket=self._bucket,
                        Delete={"Objects": objects, "Quiet": True},
                    )
                    deleted += len(objects)
                continuation_token = response.get("NextContinuationToken")
                if not continuation_token:
                    return deleted
            except ClientError as error:
                raise StorageError("gallery could not be deleted") from error
