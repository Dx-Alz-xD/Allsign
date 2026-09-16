from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # Relative SQLite paths resolve against backend/ (see database.resolve_database_url).
    DATABASE_URL: str = "sqlite:///./data/omnivoice.db"
    # Only the Kaggle dataset scripts need these, so the API boots without them.
    KAGGLE_USERNAME: str = ""
    KAGGLE_KEY: SecretStr = SecretStr("")
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    # Desktop shells, matched in full: Electron's app:// scheme and any loopback port. The packaged app loads
    # its UI over app://omnivoice, so "Origin: null" (file:// pages, but also sandboxed iframes on any website)
    # is not allowed: with credentials on, it would let any site call this API.
    CORS_ORIGIN_REGEX: str = r"app://[^/\s]*|http://127\.0\.0\.1(:\d{1,5})?"

    # Voicematics website accounts and desktop licences, kept apart from the app data in omnivoice.db.
    WEB_AUTH_DATABASE_URL: str = "sqlite:///./data/web_users.db"
    # HS256 key for session tokens, at least 32 characters. When empty, a random key is generated once and
    # stored next to web_users.db, so it never has to live in .env or git.
    AUTH_JWT_SECRET: SecretStr = SecretStr("")
    AUTH_TOKEN_TTL_MINUTES: int = 12 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
