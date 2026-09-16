"""HS256 session tokens (JWT, RFC 7519) for the Voicematics website."""

import os
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import jwt

from config import get_settings
from database import resolve_database_url

ALGORITHM = "HS256"
ISSUER = "voicematics-auth"
AUDIENCE = "voicematics-web"
MIN_SECRET_CHARS = 32
SECRET_FILE_NAME = "web_auth_jwt.key"


@dataclass(frozen=True)
class SessionToken:
    token: str
    expires_at: datetime


def secret_file() -> Path | None:
    """Where a generated key is kept: next to web_users.db. None for an in-memory database."""
    url = resolve_database_url(get_settings().WEB_AUTH_DATABASE_URL)
    if url.get_backend_name() != "sqlite" or url.database in (None, "", ":memory:"):
        return None
    return Path(url.database).with_name(SECRET_FILE_NAME)


def _load_or_create_secret(path: Path) -> str:
    try:
        existing = path.read_text(encoding="utf-8").strip()
        if len(existing) >= MIN_SECRET_CHARS:
            return existing
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    generated = secrets.token_urlsafe(48)
    # Owner-only permissions where the platform supports them; O_EXCL loses cleanly to a concurrent writer.
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return path.read_text(encoding="utf-8").strip()
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(generated)
    return generated


@lru_cache(maxsize=1)
def signing_key() -> str:
    configured = get_settings().AUTH_JWT_SECRET.get_secret_value()
    if configured:
        if len(configured) < MIN_SECRET_CHARS:
            raise RuntimeError(f"AUTH_JWT_SECRET must be at least {MIN_SECRET_CHARS} characters long")
        return configured
    path = secret_file()
    # Without a file to keep it in, sessions last until the process restarts.
    return _load_or_create_secret(path) if path else secrets.token_urlsafe(48)


def issue_token(user_id: str, email: str, tier: str, now: datetime | None = None) -> SessionToken:
    issued_at = now or datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(minutes=get_settings().AUTH_TOKEN_TTL_MINUTES)
    claims = {
        "sub": user_id,
        "email": email,
        "tier": tier,
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(claims, signing_key(), algorithm=ALGORITHM)
    return SessionToken(token, expires_at.replace(microsecond=0))


def decode_token(token: str) -> dict[str, Any]:
    """The verified claims; raises jwt.InvalidTokenError for a bad signature, algorithm, audience or expiry."""
    return jwt.decode(
        token,
        signing_key(),
        algorithms=[ALGORITHM],
        audience=AUDIENCE,
        issuer=ISSUER,
        options={"require": ["sub", "exp", "iat", "iss", "aud"]},
    )
