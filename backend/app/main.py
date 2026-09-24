"""FastAPI application for the private wedding gallery."""

import hmac
import time
import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .config import Settings, get_settings
from .models import (
    ALLOWED_UPLOADS,
    AuthStatusResponse,
    CompleteUploadRequest,
    DeleteGalleryRequest,
    DeleteResponse,
    DownloadUrlResponse,
    GalleryConfigResponse,
    LoginResponse,
    PasswordRequest,
    PhotoListResponse,
    PhotoSelectionRequest,
    UploadUrlRequest,
    UploadUrlResponse,
    validate_photo_id,
)
from .security import LoginRateLimiter, SessionClaims, SessionManager, verify_password
from .storage import (
    InvalidUploadedObject,
    PhotoNotFound,
    PhotoStorageProtocol,
    S3PhotoStorage,
    StorageError,
)

GUEST_COOKIE = "wedding_guest_session"
ADMIN_COOKIE = "wedding_admin_session"
MAX_REVERSE_TIMESTAMP = 9_999_999_999_999


def _new_photo_id(extension: str) -> str:
    reverse_timestamp = MAX_REVERSE_TIMESTAMP - int(time.time() * 1000)
    return f"r{reverse_timestamp:013d}-{uuid.uuid4().hex}.{extension}"


def _upload_extension(filename: str, content_type: str) -> str:
    suffix = Path(filename).suffix.lower()
    extension = "jpg" if suffix in {".jpg", ".jpeg"} else suffix.removeprefix(".")
    normalized_type = content_type.lower().strip()
    if extension not in ALLOWED_UPLOADS or normalized_type not in ALLOWED_UPLOADS[extension]:
        raise HTTPException(
            status_code=422,
            detail="Dateiendung und Dateityp werden nicht unterstützt oder passen nicht zusammen.",
        )
    return extension


def create_app(
    settings: Settings | None = None,
    storage: PhotoStorageProtocol | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    storage = storage or S3PhotoStorage(settings)
    sessions = SessionManager(
        settings.session_secret.get_secret_value(),
        settings.session_ttl_seconds,
    )
    rate_limiter = LoginRateLimiter(
        settings.login_max_failures,
        settings.login_window_seconds,
    )
    guest_hash = settings.wedding_guest_password_hash.get_secret_value()
    admin_hash = settings.wedding_admin_password_hash.get_secret_value()

    app = FastAPI(
        title="Private Hochzeitsgalerie API",
        version="1.0.0",
        docs_url=None if settings.app_environment == "production" else "/docs",
        redoc_url=None,
        openapi_url=None if settings.app_environment == "production" else "/openapi.json",
    )
    app.state.settings = settings
    app.state.storage = storage

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
        max_age=600,
    )

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(StorageError)
    async def handle_storage_error(_request: Request, error: StorageError):
        if isinstance(error, PhotoNotFound):
            return JSONResponse(status_code=404, content={"detail": "Foto nicht gefunden."})
        if isinstance(error, InvalidUploadedObject):
            return JSONResponse(status_code=422, content={"detail": str(error)})
        return JSONResponse(
            status_code=503,
            content={"detail": "Der Fotospeicher ist vorübergehend nicht erreichbar."},
        )

    def set_session_cookie(response: Response, name: str, token: str) -> None:
        response.set_cookie(
            key=name,
            value=token,
            max_age=settings.session_ttl_seconds,
            path="/api",
            secure=settings.cookie_secure,
            httponly=True,
            samesite=settings.cookie_samesite,
        )

    def clear_session_cookie(response: Response, name: str) -> None:
        response.delete_cookie(
            key=name,
            path="/api",
            secure=settings.cookie_secure,
            httponly=True,
            samesite=settings.cookie_samesite,
        )

    def client_key(request: Request, role: str) -> str:
        host = request.client.host if request.client else "unknown"
        return f"{role}:{host}"

    def login(
        request: Request,
        response: Response,
        credentials: PasswordRequest,
        role: Literal["guest", "admin"],
        password_hash: str,
        cookie_name: str,
    ) -> LoginResponse:
        key = client_key(request, role)
        retry_after = rate_limiter.retry_after(key)
        if retry_after is not None:
            raise HTTPException(
                status_code=429,
                detail="Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
                headers={"Retry-After": str(retry_after)},
            )
        if not verify_password(credentials.password, password_hash):
            rate_limiter.record_failure(key)
            raise HTTPException(status_code=401, detail="Passwort ist nicht korrekt.")

        rate_limiter.reset(key)
        token, claims = sessions.issue(role, password_hash)
        set_session_cookie(response, cookie_name, token)
        return LoginResponse(csrf_token=claims.csrf_token)

    def guest_claims(
        token: Annotated[str | None, Cookie(alias=GUEST_COOKIE)] = None,
    ) -> SessionClaims:
        claims = sessions.verify(token, "guest", guest_hash)
        if not claims:
            raise HTTPException(status_code=401, detail="Bitte erneut anmelden.")
        return claims

    def admin_claims(
        token: Annotated[str | None, Cookie(alias=ADMIN_COOKIE)] = None,
    ) -> SessionClaims:
        claims = sessions.verify(token, "admin", admin_hash)
        if not claims:
            raise HTTPException(status_code=401, detail="Admin-Anmeldung erforderlich.")
        return claims

    def require_csrf(
        claims: SessionClaims,
        supplied_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
    ) -> None:
        if not supplied_token or not hmac.compare_digest(claims.csrf_token, supplied_token):
            raise HTTPException(status_code=403, detail="Ungültiger CSRF-Schutz.")

    def guest_write(
        claims: Annotated[SessionClaims, Depends(guest_claims)],
        supplied_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
    ) -> SessionClaims:
        require_csrf(claims, supplied_token)
        return claims

    def admin_write(
        claims: Annotated[SessionClaims, Depends(admin_claims)],
        supplied_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
    ) -> SessionClaims:
        require_csrf(claims, supplied_token)
        return claims

    @app.get("/healthz", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/auth/login", response_model=LoginResponse)
    def guest_login(
        request: Request,
        response: Response,
        credentials: PasswordRequest,
    ) -> LoginResponse:
        return login(request, response, credentials, "guest", guest_hash, GUEST_COOKIE)

    @app.get("/api/auth/status", response_model=AuthStatusResponse)
    def guest_status(
        token: Annotated[str | None, Cookie(alias=GUEST_COOKIE)] = None,
    ) -> AuthStatusResponse:
        claims = sessions.verify(token, "guest", guest_hash)
        return AuthStatusResponse(
            authenticated=claims is not None,
            csrf_token=claims.csrf_token if claims else None,
        )

    @app.post("/api/auth/logout", status_code=204)
    def guest_logout(
        response: Response,
        _claims: Annotated[SessionClaims, Depends(guest_write)],
    ) -> Response:
        clear_session_cookie(response, GUEST_COOKIE)
        response.status_code = 204
        return response

    @app.get("/api/photos", response_model=PhotoListResponse)
    def list_photos(
        _claims: Annotated[SessionClaims, Depends(guest_claims)],
        cursor: Annotated[str | None, Query()] = None,
        limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    ) -> PhotoListResponse:
        if cursor:
            try:
                validate_photo_id(cursor)
            except ValueError as error:
                raise HTTPException(status_code=422, detail="Ungültiger Cursor.") from error
        page = storage.list_photos(limit or settings.gallery_page_size, cursor)
        return PhotoListResponse(photos=page.photos, next_cursor=page.next_cursor)

    @app.get("/api/config", response_model=GalleryConfigResponse)
    def gallery_config(
        _claims: Annotated[SessionClaims, Depends(guest_claims)],
    ) -> GalleryConfigResponse:
        return GalleryConfigResponse(
            max_upload_size=settings.max_upload_size,
            retention_until=settings.retention_until,
            supported_content_types=sorted(
                {content_type for types in ALLOWED_UPLOADS.values() for content_type in types},
            ),
        )

    @app.post("/api/photos/upload-url", response_model=UploadUrlResponse)
    def create_upload_url(
        upload: UploadUrlRequest,
        _claims: Annotated[SessionClaims, Depends(guest_write)],
    ) -> UploadUrlResponse:
        if not upload.consent_confirmed:
            raise HTTPException(status_code=422, detail="Bitte bestätige die Upload-Freigabe.")
        if upload.size_bytes > settings.max_upload_size:
            raise HTTPException(
                status_code=413,
                detail=f"Die Datei darf höchstens {settings.max_upload_size} Bytes groß sein.",
            )
        extension = _upload_extension(upload.filename, upload.content_type)
        photo_id = _new_photo_id(extension)
        target = storage.create_upload_target(
            photo_id,
            upload.filename,
            upload.content_type.lower().strip(),
        )
        return UploadUrlResponse(
            photo_id=photo_id,
            upload_url=target.url,
            required_headers=target.headers,
            expires_in=settings.signed_url_ttl_seconds,
        )

    @app.post("/api/photos/{photo_id}/complete", status_code=204)
    def complete_upload(
        photo_id: str,
        completion: CompleteUploadRequest,
        _claims: Annotated[SessionClaims, Depends(guest_write)],
    ) -> Response:
        try:
            validate_photo_id(photo_id)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Ungültige Foto-ID.") from error
        if completion.photo_id != photo_id:
            raise HTTPException(status_code=422, detail="Foto-IDs stimmen nicht überein.")
        storage.complete_upload(photo_id)
        return Response(status_code=204)

    @app.get("/api/photos/{photo_id}/download-url", response_model=DownloadUrlResponse)
    def create_download_url(
        photo_id: str,
        _claims: Annotated[SessionClaims, Depends(guest_claims)],
        disposition: Annotated[Literal["inline", "attachment"], Query()] = "attachment",
    ) -> DownloadUrlResponse:
        try:
            validate_photo_id(photo_id)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Ungültige Foto-ID.") from error
        url = storage.create_download_url(photo_id, inline=disposition == "inline")
        return DownloadUrlResponse(
            download_url=url,
            expires_in=settings.signed_url_ttl_seconds,
        )

    @app.post("/api/photos/download")
    def download_photo_selection(
        selection: PhotoSelectionRequest,
        _claims: Annotated[SessionClaims, Depends(guest_write)],
    ) -> StreamingResponse:
        archive = storage.stream_photo_archive(selection.photo_ids)
        return StreamingResponse(
            archive,
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="hochzeitsfotos.zip"',
            },
        )

    @app.post("/api/admin/auth/login", response_model=LoginResponse)
    def admin_login(
        request: Request,
        response: Response,
        credentials: PasswordRequest,
    ) -> LoginResponse:
        return login(request, response, credentials, "admin", admin_hash, ADMIN_COOKIE)

    @app.get("/api/admin/auth/status", response_model=AuthStatusResponse)
    def admin_status(
        token: Annotated[str | None, Cookie(alias=ADMIN_COOKIE)] = None,
    ) -> AuthStatusResponse:
        claims = sessions.verify(token, "admin", admin_hash)
        return AuthStatusResponse(
            authenticated=claims is not None,
            csrf_token=claims.csrf_token if claims else None,
        )

    @app.post("/api/admin/auth/logout", status_code=204)
    def admin_logout(
        response: Response,
        _claims: Annotated[SessionClaims, Depends(admin_write)],
    ) -> Response:
        clear_session_cookie(response, ADMIN_COOKIE)
        response.status_code = 204
        return response

    @app.get("/api/admin/photos", response_model=PhotoListResponse)
    def admin_list_photos(
        _claims: Annotated[SessionClaims, Depends(admin_claims)],
        cursor: Annotated[str | None, Query()] = None,
        limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    ) -> PhotoListResponse:
        if cursor:
            try:
                validate_photo_id(cursor)
            except ValueError as error:
                raise HTTPException(status_code=422, detail="Ungültiger Cursor.") from error
        page = storage.list_photos(limit or settings.gallery_page_size, cursor)
        return PhotoListResponse(photos=page.photos, next_cursor=page.next_cursor)

    @app.delete("/api/admin/photos/selection", response_model=DeleteResponse)
    def admin_delete_photo_selection(
        selection: PhotoSelectionRequest,
        _claims: Annotated[SessionClaims, Depends(admin_write)],
    ) -> DeleteResponse:
        return DeleteResponse(deleted=storage.delete_photos(selection.photo_ids))

    @app.delete("/api/admin/photos/{photo_id}", response_model=DeleteResponse)
    def admin_delete_photo(
        photo_id: str,
        _claims: Annotated[SessionClaims, Depends(admin_write)],
    ) -> DeleteResponse:
        try:
            validate_photo_id(photo_id)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Ungültige Foto-ID.") from error
        return DeleteResponse(deleted=storage.delete_photo(photo_id))

    @app.delete("/api/admin/photos", response_model=DeleteResponse)
    def admin_delete_all(
        request_body: DeleteGalleryRequest,
        _claims: Annotated[SessionClaims, Depends(admin_write)],
    ) -> DeleteResponse:
        if request_body.confirmation != "ALLE_FOTOS_ENDGUELTIG_LOESCHEN":
            raise HTTPException(status_code=422, detail="Bestätigungstext ist nicht korrekt.")
        return DeleteResponse(deleted=storage.delete_all())

    return app


app = create_app()
