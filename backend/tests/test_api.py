from __future__ import annotations

from conftest import GUEST_PASSWORD, FakeStorage
from fastapi.testclient import TestClient


def test_guest_authentication_success_and_status(client: TestClient) -> None:
    login = client.post("/api/auth/login", json={"password": GUEST_PASSWORD})

    assert login.status_code == 200
    assert login.json()["authenticated"] is True
    assert login.json()["csrf_token"]
    assert client.get("/api/auth/status").json()["authenticated"] is True


def test_guest_authentication_failure(client: TestClient) -> None:
    response = client.post("/api/auth/login", json={"password": "wrong-password"})

    assert response.status_code == 401
    assert "Passwort" in response.json()["detail"]


def test_failed_logins_are_rate_limited(client: TestClient) -> None:
    for _ in range(8):
        assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401

    response = client.post("/api/auth/login", json={"password": "wrong"})

    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_unauthenticated_gallery_access_is_rejected(client: TestClient) -> None:
    assert client.get("/api/photos").status_code == 401


def test_authenticated_config_comes_from_backend(
    client: TestClient,
    guest_session: dict[str, str],
) -> None:
    response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json()["max_upload_size"] == 1_000_000
    assert "image/heic" in response.json()["supported_content_types"]


def test_upload_url_is_generated_for_valid_image(
    client: TestClient,
    guest_session: dict[str, str],
    fake_storage: FakeStorage,
) -> None:
    response = client.post(
        "/api/photos/upload-url",
        headers=guest_session,
        json={
            "filename": "Unser Foto.JPG",
            "content_type": "image/jpeg",
            "size_bytes": 123_456,
            "consent_confirmed": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["photo_id"].endswith(".jpg")
    assert payload["upload_url"] == "https://objects.invalid/signed-upload"
    assert fake_storage.upload_calls[0][1:] == ("Unser Foto.JPG", "image/jpeg")


def test_upload_rejects_invalid_file_type(
    client: TestClient,
    guest_session: dict[str, str],
) -> None:
    response = client.post(
        "/api/photos/upload-url",
        headers=guest_session,
        json={
            "filename": "malware.exe",
            "content_type": "application/octet-stream",
            "size_bytes": 100,
            "consent_confirmed": True,
        },
    )

    assert response.status_code == 422


def test_upload_rejects_mismatched_extension_and_type(
    client: TestClient,
    guest_session: dict[str, str],
) -> None:
    response = client.post(
        "/api/photos/upload-url",
        headers=guest_session,
        json={
            "filename": "photo.png",
            "content_type": "image/jpeg",
            "size_bytes": 100,
            "consent_confirmed": True,
        },
    )

    assert response.status_code == 422


def test_upload_rejects_oversized_file(
    client: TestClient,
    guest_session: dict[str, str],
) -> None:
    response = client.post(
        "/api/photos/upload-url",
        headers=guest_session,
        json={
            "filename": "photo.jpg",
            "content_type": "image/jpeg",
            "size_bytes": 1_000_001,
            "consent_confirmed": True,
        },
    )

    assert response.status_code == 413


def test_upload_requires_consent_and_csrf(
    client: TestClient,
    guest_session: dict[str, str],
) -> None:
    request = {
        "filename": "photo.jpg",
        "content_type": "image/jpeg",
        "size_bytes": 100,
        "consent_confirmed": False,
    }
    assert client.post("/api/photos/upload-url", json=request).status_code == 403
    assert (
        client.post("/api/photos/upload-url", headers=guest_session, json=request).status_code
        == 422
    )


def test_guest_cannot_use_admin_operations(
    client: TestClient,
    guest_session: dict[str, str],
) -> None:
    photo_id = "r8000000000000-0123456789abcdef0123456789abcdef.jpg"

    response = client.delete(f"/api/admin/photos/{photo_id}", headers=guest_session)

    assert response.status_code == 401


def test_guest_can_download_multiple_photos_as_zip(
    client: TestClient,
    guest_session: dict[str, str],
    fake_storage: FakeStorage,
) -> None:
    photo_ids = [
        "r8000000000000-0123456789abcdef0123456789abcdef.jpg",
        "r8000000000001-fedcba9876543210fedcba9876543210.png",
    ]

    response = client.post(
        "/api/photos/download",
        headers=guest_session,
        json={"photo_ids": photo_ids},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.content == b"zip-content"
    assert fake_storage.archive_calls == [photo_ids]


def test_bulk_download_requires_session_and_csrf(client: TestClient) -> None:
    photo_id = "r8000000000000-0123456789abcdef0123456789abcdef.jpg"

    no_session = client.post("/api/photos/download", json={"photo_ids": [photo_id]})
    client.post("/api/auth/login", json={"password": GUEST_PASSWORD})
    no_csrf = client.post(
        "/api/photos/download",
        json={"photo_ids": [photo_id]},
    )

    assert no_session.status_code == 401
    assert no_csrf.status_code == 403


def test_bulk_download_rejects_duplicate_photo_ids(
    client: TestClient,
    guest_session: dict[str, str],
) -> None:
    photo_id = "r8000000000000-0123456789abcdef0123456789abcdef.jpg"

    response = client.post(
        "/api/photos/download",
        headers=guest_session,
        json={"photo_ids": [photo_id, photo_id]},
    )

    assert response.status_code == 422


def test_admin_can_delete_photo(
    client: TestClient,
    admin_session: dict[str, str],
    fake_storage: FakeStorage,
) -> None:
    photo_id = "r8000000000000-0123456789abcdef0123456789abcdef.jpg"

    response = client.delete(f"/api/admin/photos/{photo_id}", headers=admin_session)

    assert response.status_code == 200
    assert response.json() == {"deleted": 1}
    assert fake_storage.deleted == [photo_id]


def test_admin_can_delete_multiple_photos(
    client: TestClient,
    admin_session: dict[str, str],
    fake_storage: FakeStorage,
) -> None:
    photo_ids = [
        "r8000000000000-0123456789abcdef0123456789abcdef.jpg",
        "r8000000000001-fedcba9876543210fedcba9876543210.png",
    ]

    response = client.request(
        "DELETE",
        "/api/admin/photos/selection",
        headers=admin_session,
        json={"photo_ids": photo_ids},
    )

    assert response.status_code == 200
    assert response.json() == {"deleted": 2}
    assert fake_storage.deleted == photo_ids


def test_admin_authentication_rejects_guest_password(client: TestClient) -> None:
    response = client.post("/api/admin/auth/login", json={"password": GUEST_PASSWORD})

    assert response.status_code == 401


def test_admin_can_delete_entire_gallery_only_with_exact_confirmation(
    client: TestClient,
    admin_session: dict[str, str],
    fake_storage: FakeStorage,
) -> None:
    wrong = client.request(
        "DELETE",
        "/api/admin/photos",
        headers=admin_session,
        json={"confirmation": "delete"},
    )
    correct = client.request(
        "DELETE",
        "/api/admin/photos",
        headers=admin_session,
        json={"confirmation": "ALLE_FOTOS_ENDGUELTIG_LOESCHEN"},
    )

    assert wrong.status_code == 422
    assert correct.status_code == 200
    assert correct.json() == {"deleted": 3}
    assert fake_storage.delete_all_calls == 1


def test_invalid_photo_id_cannot_reach_storage(
    client: TestClient,
    admin_session: dict[str, str],
    fake_storage: FakeStorage,
) -> None:
    response = client.delete("/api/admin/photos/not-a-photo", headers=admin_session)

    assert response.status_code == 422
    assert fake_storage.deleted == []


def test_cors_allows_only_configured_frontend(client: TestClient) -> None:
    allowed = client.options(
        "/api/auth/login",
        headers={
            "Origin": "http://localhost:8000",
            "Access-Control-Request-Method": "POST",
        },
    )
    denied = client.options(
        "/api/auth/login",
        headers={
            "Origin": "https://attacker.invalid",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert allowed.headers["access-control-allow-origin"] == "http://localhost:8000"
    assert "access-control-allow-origin" not in denied.headers
