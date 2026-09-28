from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from typing import Any

import pytest
from PIL import Image

from app.models import validate_photo_id
from app.storage import InvalidUploadedObject, S3PhotoStorage, original_key, thumbnail_key

PHOTO_ID = "r8000000000000-0123456789abcdef0123456789abcdef.jpg"


class SigningClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def generate_presigned_url(self, operation: str, **kwargs: Any) -> str:
        self.calls.append((operation, kwargs))
        return "https://objects.invalid/signed"


class ArchiveClient:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects
        self.deleted_keys: list[str] = []

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        return {"ContentLength": len(self.objects[Key])}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        return {"Body": io.BytesIO(self.objects[Key])}

    def delete_objects(self, *, Bucket: str, Delete: dict[str, Any]) -> dict[str, Any]:
        self.deleted_keys.extend(item["Key"] for item in Delete["Objects"])
        return {}


class ListingClient:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = responses
        self.list_calls: list[dict[str, Any]] = []

    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
        self.list_calls.append(kwargs)
        return self.responses.pop(0)

    def generate_presigned_url(self, operation: str, **kwargs: Any) -> str:
        return "https://objects.invalid/signed-thumbnail"


def test_upload_signature_contains_only_server_generated_key(settings) -> None:
    client = SigningClient()
    storage = S3PhotoStorage(settings, client=client)

    target = storage.create_upload_target(PHOTO_ID, "Urlaub 2026.jpg", "image/jpeg")

    operation, call = client.calls[0]
    assert operation == "put_object"
    assert call["Params"]["Key"] == f"originals/{PHOTO_ID}"
    assert "Urlaub 2026.jpg" not in call["Params"]["Key"]
    assert target.headers["x-amz-meta-photo-id"] == PHOTO_ID
    assert call["ExpiresIn"] == settings.signed_url_ttl_seconds


@pytest.mark.parametrize(
    "unsafe_id",
    ["../secret.jpg", "originals/photo.jpg", "photo.jpg", "", "r123-abc.jpg"],
)
def test_storage_keys_reject_unsafe_photo_ids(unsafe_id: str) -> None:
    with pytest.raises(ValueError):
        original_key(unsafe_id)
    with pytest.raises(ValueError):
        thumbnail_key(unsafe_id)


def test_photo_id_validator_accepts_expected_shape() -> None:
    assert validate_photo_id(PHOTO_ID) == PHOTO_ID


def test_first_photo_page_includes_total_count(settings) -> None:
    second_photo_id = "r8000000000001-fedcba9876543210fedcba9876543210.png"
    client = ListingClient(
        [
            {
                "Contents": [
                    {
                        "Key": thumbnail_key(PHOTO_ID),
                        "LastModified": datetime(2026, 9, 22, tzinfo=UTC),
                    },
                ],
                "IsTruncated": True,
                "NextContinuationToken": "next-page",
            },
            {
                "Contents": [
                    {
                        "Key": thumbnail_key(second_photo_id),
                        "LastModified": datetime(2026, 9, 23, tzinfo=UTC),
                    },
                ],
                "IsTruncated": False,
            },
        ],
    )
    storage = S3PhotoStorage(settings, client=client)

    page = storage.list_photos(limit=1)

    assert len(page.photos) == 1
    assert page.total_count == 2
    assert page.next_cursor == PHOTO_ID
    assert client.list_calls[1]["ContinuationToken"] == "next-page"


def test_thumbnail_is_resized_and_contains_no_exif(settings) -> None:
    source = io.BytesIO()
    image = Image.new("RGB", (1600, 900), color=(20, 80, 50))
    exif = Image.Exif()
    exif[0x010E] = "private description"
    image.save(source, format="JPEG", exif=exif)
    source.seek(0)
    storage = S3PhotoStorage(settings, client=SigningClient())

    thumbnail_bytes = storage._render_thumbnail(source, "jpg")

    with Image.open(io.BytesIO(thumbnail_bytes)) as thumbnail:
        assert thumbnail.format == "WEBP"
        assert max(thumbnail.size) <= settings.thumbnail_max_dimension
        assert len(thumbnail.getexif()) == 0


def test_thumbnail_rejects_content_that_does_not_match_extension(settings) -> None:
    source = io.BytesIO()
    Image.new("RGB", (100, 100)).save(source, format="PNG")
    source.seek(0)
    storage = S3PhotoStorage(settings, client=SigningClient())

    with pytest.raises(InvalidUploadedObject):
        storage._render_thumbnail(source, "jpg")


def test_multiple_originals_are_streamed_as_valid_zip(settings) -> None:
    second_photo_id = "r8000000000001-fedcba9876543210fedcba9876543210.png"
    client = ArchiveClient(
        {
            original_key(PHOTO_ID): b"first-image",
            original_key(second_photo_id): b"second-image",
        },
    )
    storage = S3PhotoStorage(settings, client=client)

    archive_bytes = b"".join(storage.stream_photo_archive([PHOTO_ID, second_photo_id]))

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        assert archive.namelist() == ["hochzeitsfoto-001.jpg", "hochzeitsfoto-002.png"]
        assert archive.read("hochzeitsfoto-001.jpg") == b"first-image"
        assert archive.read("hochzeitsfoto-002.png") == b"second-image"


def test_multiple_photos_are_deleted_in_one_storage_request(settings) -> None:
    second_photo_id = "r8000000000001-fedcba9876543210fedcba9876543210.png"
    client = ArchiveClient(
        {
            original_key(PHOTO_ID): b"first-image",
            original_key(second_photo_id): b"second-image",
        },
    )
    storage = S3PhotoStorage(settings, client=client)

    deleted = storage.delete_photos([PHOTO_ID, second_photo_id])

    assert deleted == 2
    assert client.deleted_keys == [
        original_key(PHOTO_ID),
        thumbnail_key(PHOTO_ID),
        original_key(second_photo_id),
        thumbnail_key(second_photo_id),
    ]
