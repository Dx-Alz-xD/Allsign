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
    # Desktop shells, matched in full: Electron's app:// scheme, any loopback port, and file:// pages.
    # Chromium sends "Origin: null" for file:// pages, and sandboxed iframes on any website send the same
    # value, so drop "|null" here once the packaged app loads its UI over app:// or http.
    CORS_ORIGIN_REGEX: str = r"app://[^/\s]*|http://127\.0\.0\.1(:\d{1,5})?|file://.*|null"


@lru_cache
def get_settings() -> Settings:
    return Settings()
