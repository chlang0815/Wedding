"""Environment-based application configuration."""

from __future__ import annotations

import hmac
from datetime import date
from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings. Secrets are never read from frontend configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_environment: Literal["development", "production", "test"] = "production"
    frontend_origin: str

    s3_endpoint_url: str
    s3_access_key_id: SecretStr
    s3_secret_access_key: SecretStr
    s3_bucket: str
    s3_region: str = "fsn1"
    s3_addressing_style: Literal["auto", "path", "virtual"] = "virtual"

    wedding_guest_password_hash: SecretStr
    wedding_admin_password_hash: SecretStr
    session_secret: SecretStr
    session_ttl_seconds: int = Field(default=86_400, ge=300, le=604_800)
    cookie_secure: bool = True
    cookie_samesite: Literal["lax", "strict", "none"] = "none"

    signed_url_ttl_seconds: int = Field(default=600, ge=60, le=3_600)
    max_upload_size: int = Field(default=25 * 1024 * 1024, ge=1024)
    max_image_pixels: int = Field(default=50_000_000, ge=1_000_000)
    thumbnail_max_dimension: int = Field(default=1_280, ge=320, le=3_000)
    gallery_page_size: int = Field(default=50, ge=10, le=100)

    login_max_failures: int = Field(default=8, ge=2, le=100)
    login_window_seconds: int = Field(default=900, ge=60, le=86_400)
    retention_until: date = date(2027, 3, 31)

    @field_validator("frontend_origin")
    @classmethod
    def validate_frontend_origin(cls, value: str) -> str:
        origin = value.rstrip("/")
        if not origin.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            raise ValueError("FRONTEND_ORIGIN must use HTTPS (except for local development)")
        parsed = urlsplit(origin)
        if (
            not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "FRONTEND_ORIGIN must be an origin without path, query, or credentials",
            )
        return origin

    @field_validator("session_secret")
    @classmethod
    def validate_session_secret(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("SESSION_SECRET must contain at least 32 characters")
        return value

    @model_validator(mode="after")
    def validate_cookie_policy(self) -> Settings:
        if self.app_environment == "production" and not self.cookie_secure:
            raise ValueError("COOKIE_SECURE must be true in production")
        if self.app_environment == "production" and not self.s3_endpoint_url.startswith("https://"):
            raise ValueError("S3_ENDPOINT_URL must use HTTPS in production")
        if self.cookie_samesite == "none" and not self.cookie_secure:
            if self.app_environment == "production":
                raise ValueError("SameSite=None cookies must be Secure")
        if hmac_compare_secrets(
            self.wedding_guest_password_hash,
            self.wedding_admin_password_hash,
        ):
            raise ValueError("Guest and admin password hashes must be different")
        return self


def hmac_compare_secrets(first: SecretStr, second: SecretStr) -> bool:
    """Compare secret settings without exposing them in validation output."""

    return hmac.compare_digest(first.get_secret_value(), second.get_secret_value())


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
