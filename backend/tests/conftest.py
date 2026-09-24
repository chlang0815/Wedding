from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

TEST_HASHER = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1)
GUEST_PASSWORD = "guest-test-password"
ADMIN_PASSWORD = "admin-test-password"

# app.main exposes an ASGI app for Uvicorn at import time. Safe dummy values keep
# that import isolated; individual tests use their own Settings instance.
os.environ.setdefault("FRONTEND_ORIGIN", "http://localhost:8000")
os.environ.setdefault("S3_ENDPOINT_URL", "https://objects.invalid")
os.environ.setdefault("S3_ACCESS_KEY_ID", "test-key")
os.environ.setdefault("S3_SECRET_ACCESS_KEY", "test-secret")
os.environ.setdefault("S3_BUCKET", "test-bucket")
os.environ.setdefault("WEDDING_GUEST_PASSWORD_HASH", TEST_HASHER.hash(GUEST_PASSWORD))
os.environ.setdefault("WEDDING_ADMIN_PASSWORD_HASH", TEST_HASHER.hash(ADMIN_PASSWORD))
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-longer-than-32-characters")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("COOKIE_SAMESITE", "lax")
os.environ.setdefault("APP_ENVIRONMENT", "test")

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import PhotoItem  # noqa: E402
from app.storage import PhotoPage, UploadTarget  # noqa: E402


class FakeStorage:
    def __init__(self) -> None:
        self.upload_calls: list[tuple[str, str, str]] = []
        self.completed: list[str] = []
        self.deleted: list[str] = []
        self.archive_calls: list[list[str]] = []
        self.delete_all_calls = 0

    def create_upload_target(
        self,
        photo_id: str,
        filename: str,
        content_type: str,
    ) -> UploadTarget:
        self.upload_calls.append((photo_id, filename, content_type))
        return UploadTarget(
            url="https://objects.invalid/signed-upload",
            headers={"Content-Type": content_type, "x-amz-meta-photo-id": photo_id},
        )

    def complete_upload(self, photo_id: str) -> None:
        self.completed.append(photo_id)

    def list_photos(self, limit: int, cursor: str | None = None) -> PhotoPage:
        return PhotoPage(
            photos=[
                PhotoItem(
                    id="r8000000000000-0123456789abcdef0123456789abcdef.jpg",
                    thumbnail_url="https://objects.invalid/signed-thumbnail",
                    uploaded_at=datetime(2026, 9, 22, tzinfo=UTC),
                ),
            ],
            next_cursor=None,
        )

    def create_download_url(self, photo_id: str, inline: bool = False) -> str:
        mode = "inline" if inline else "attachment"
        return f"https://objects.invalid/signed-download?mode={mode}"

    def stream_photo_archive(self, photo_ids: list[str]) -> Iterator[bytes]:
        self.archive_calls.append(photo_ids)
        return iter((b"zip-content",))

    def delete_photo(self, photo_id: str) -> int:
        self.deleted.append(photo_id)
        return 1

    def delete_photos(self, photo_ids: list[str]) -> int:
        self.deleted.extend(photo_ids)
        return len(photo_ids)

    def delete_all(self) -> int:
        self.delete_all_calls += 1
        return 3


@pytest.fixture
def settings() -> Settings:
    return Settings(
        app_environment="test",
        frontend_origin="http://localhost:8000",
        s3_endpoint_url="https://objects.invalid",
        s3_access_key_id="test-key",
        s3_secret_access_key="test-secret",
        s3_bucket="test-bucket",
        wedding_guest_password_hash=TEST_HASHER.hash(GUEST_PASSWORD),
        wedding_admin_password_hash=TEST_HASHER.hash(ADMIN_PASSWORD),
        session_secret="test-session-secret-that-is-longer-than-32-characters",
        cookie_secure=False,
        cookie_samesite="lax",
        max_upload_size=1_000_000,
    )


@pytest.fixture
def fake_storage() -> FakeStorage:
    return FakeStorage()


@pytest.fixture
def client(settings: Settings, fake_storage: FakeStorage) -> TestClient:
    return TestClient(create_app(settings=settings, storage=fake_storage))


@pytest.fixture
def guest_session(client: TestClient) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"password": GUEST_PASSWORD})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}


@pytest.fixture
def admin_session(client: TestClient) -> dict[str, str]:
    response = client.post("/api/admin/auth/login", json={"password": ADMIN_PASSWORD})
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["csrf_token"]}
