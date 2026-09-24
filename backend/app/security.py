"""Password verification, signed sessions, CSRF, and login throttling."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Literal

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

Role = Literal["guest", "admin"]


def verify_password(password: str, password_hash: str) -> bool:
    """Verify an Argon2 hash without leaking comparison details."""

    try:
        return PasswordHasher().verify(password_hash, password)
    except (InvalidHashError, VerifyMismatchError):
        return False


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True)
class SessionClaims:
    role: Role
    expires_at: int
    csrf_token: str


class SessionManager:
    """Issue stateless, HMAC-authenticated session cookies."""

    def __init__(self, secret: str, ttl_seconds: int) -> None:
        self._secret = secret.encode("utf-8")
        self._ttl_seconds = ttl_seconds

    def _credential_revision(self, password_hash: str) -> str:
        return hmac.new(
            self._secret,
            f"credential:{password_hash}".encode(),
            hashlib.sha256,
        ).hexdigest()[:24]

    def issue(self, role: Role, password_hash: str) -> tuple[str, SessionClaims]:
        claims = SessionClaims(
            role=role,
            expires_at=int(time.time()) + self._ttl_seconds,
            csrf_token=secrets.token_urlsafe(24),
        )
        payload = {
            "role": claims.role,
            "exp": claims.expires_at,
            "csrf": claims.csrf_token,
            "rev": self._credential_revision(password_hash),
            "nonce": secrets.token_urlsafe(12),
        }
        encoded = _b64encode(
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"),
        )
        signature = _b64encode(
            hmac.new(self._secret, encoded.encode("ascii"), hashlib.sha256).digest(),
        )
        return f"{encoded}.{signature}", claims

    def verify(
        self,
        token: str | None,
        expected_role: Role,
        password_hash: str,
    ) -> SessionClaims | None:
        if not token:
            return None

        try:
            encoded, supplied_signature = token.split(".", 1)
            expected_signature = _b64encode(
                hmac.new(self._secret, encoded.encode("ascii"), hashlib.sha256).digest(),
            )
            if not hmac.compare_digest(supplied_signature, expected_signature):
                return None

            payload = json.loads(_b64decode(encoded))
            if payload.get("role") != expected_role:
                return None
            if int(payload.get("exp", 0)) <= int(time.time()):
                return None
            if not hmac.compare_digest(
                str(payload.get("rev", "")),
                self._credential_revision(password_hash),
            ):
                return None

            csrf_token = str(payload.get("csrf", ""))
            if len(csrf_token) < 20:
                return None

            return SessionClaims(
                role=expected_role,
                expires_at=int(payload["exp"]),
                csrf_token=csrf_token,
            )
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None


class LoginRateLimiter:
    """Small in-memory sliding-window limiter for failed login attempts."""

    def __init__(self, max_failures: int, window_seconds: int) -> None:
        self._max_failures = max_failures
        self._window_seconds = window_seconds
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures[key]
        threshold = now - self._window_seconds
        while attempts and attempts[0] <= threshold:
            attempts.popleft()
        return attempts

    def retry_after(self, key: str) -> int | None:
        now = time.monotonic()
        with self._lock:
            attempts = self._prune(key, now)
            if len(attempts) < self._max_failures:
                return None
            return max(1, int(self._window_seconds - (now - attempts[0])))

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(key, now).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
