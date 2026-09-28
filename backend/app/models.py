"""Validated API request and response models."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ALLOWED_UPLOADS: dict[str, tuple[str, ...]] = {
    "jpg": ("image/jpeg",),
    "png": ("image/png",),
    "webp": ("image/webp",),
    "heic": (
        "image/heic",
        "image/heif",
        "image/heic-sequence",
        "image/heif-sequence",
        "image/x-heic",
        "image/x-heif",
    ),
    "heif": (
        "image/heif",
        "image/heic",
        "image/heif-sequence",
        "image/heic-sequence",
        "image/x-heif",
        "image/x-heic",
    ),
}
PHOTO_ID_PATTERN = re.compile(
    r"^r\d{13}-[0-9a-f]{32}\.(?:jpg|png|webp|heic|heif)$",
)
MAX_PHOTO_SELECTION = 100


def validate_photo_id(value: str) -> str:
    if not PHOTO_ID_PATTERN.fullmatch(value):
        raise ValueError("invalid photo id")
    return value


class PasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    authenticated: Literal[True] = True
    csrf_token: str


class AuthStatusResponse(BaseModel):
    authenticated: bool
    csrf_token: str | None = None


class GalleryConfigResponse(BaseModel):
    max_upload_size: int
    retention_until: date
    supported_content_types: list[str]


class UploadUrlRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=100)
    size_bytes: int = Field(gt=0)
    consent_confirmed: bool

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        if value != value.strip() or any(ord(character) < 32 for character in value):
            raise ValueError("invalid filename")
        if "/" in value or "\\" in value or value in {".", ".."}:
            raise ValueError("filename must not contain a path")
        return value


class UploadUrlResponse(BaseModel):
    photo_id: str
    upload_url: str
    required_headers: dict[str, str]
    expires_in: int


class CompleteUploadRequest(BaseModel):
    photo_id: str

    _validate_id = field_validator("photo_id")(validate_photo_id)


class PhotoItem(BaseModel):
    id: str
    thumbnail_url: str
    uploaded_at: datetime


class PhotoListResponse(BaseModel):
    photos: list[PhotoItem]
    next_cursor: str | None = None
    total_count: int | None = Field(default=None, ge=0)


class DownloadUrlResponse(BaseModel):
    download_url: str
    expires_in: int


class PhotoSelectionRequest(BaseModel):
    photo_ids: list[str] = Field(min_length=1, max_length=MAX_PHOTO_SELECTION)

    @field_validator("photo_ids")
    @classmethod
    def validate_photo_ids(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("photo ids must be unique")
        for value in values:
            validate_photo_id(value)
        return values


class DeleteGalleryRequest(BaseModel):
    confirmation: str


class DeleteResponse(BaseModel):
    deleted: int
