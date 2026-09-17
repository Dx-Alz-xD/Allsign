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
    # The desktop app in dev (3000) and the Voicematics website (3100).
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3100", "http://127.0.0.1:3100"]
    # Desktop shells, matched in full: Electron's app:// scheme and any loopback port. The packaged app loads
    # its UI over app://omnivoice, so "Origin: null" (file:// pages, but also sandboxed iframes on any website)
    # is not allowed: with credentials on, it would let any site call this API.
    CORS_ORIGIN_REGEX: str = r"app://[^/\s]*|http://127\.0\.0\.1(:\d{1,5})?"

    # The hosted service: triggers, presets, sessions, phoneme targets, the caregiver relay and the sentence
    # refiner need a signed-in account, and each plan's features are enforced (ownership.py). Turn it off for a
    # single-user install on your own machine, where requests without a token get every feature.
    REQUIRE_ACCOUNT: bool = True

    # Voicematics website accounts and desktop licences, kept apart from the app data in omnivoice.db.
    WEB_AUTH_DATABASE_URL: str = "sqlite:///./data/web_users.db"
    # HS256 key for session tokens, at least 32 characters. When empty, a random key is generated once and
    # stored next to web_users.db, so it never has to live in .env or git.
    AUTH_JWT_SECRET: SecretStr = SecretStr("")
    AUTH_TOKEN_TTL_MINUTES: int = 12 * 60

    # The one language-model agent (agents/sentence_refiner.py): ClearVoice's second answer. It never blocks the
    # speech path (CLAUDE.md section 7). Gemini is tried first and Groq takes over when a Gemini call fails; with
    # both keys empty /api/agent/refine-sentence answers 503.
    GEMINI_API_KEY: SecretStr = SecretStr("")
    GEMINI_MODEL: str = "gemini-flash-latest"
    # Tried after GEMINI_MODEL by the sentence refiner only, when that model is overloaded; empty to skip.
    GEMINI_REFINE_FALLBACK_MODEL: str = "gemini-flash-lite-latest"
    GROQ_API_KEY: SecretStr = SecretStr("")
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    # Separate allowance for /api/agent/refine-sentence, which the desktop app calls once per spoken sentence.
    REFINE_RATE_LIMIT_PER_MINUTE: int = 60
    # Where the website sends people for the desktop installer (electron-builder publishes there).
    INSTALLER_DOWNLOAD_URL: str = "https://github.com/Dx-Alz-xD/Voicematics/releases/latest/download/Voicematics-Setup.exe"


@lru_cache
def get_settings() -> Settings:
    return Settings()
