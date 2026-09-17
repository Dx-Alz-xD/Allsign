"""Store for website accounts and desktop licences.

With SQLite it is a separate file from omnivoice.db: account data has its own lifecycle, and the app's data
exports and benchmarks never touch it. Relative paths resolve against backend/, like DATABASE_URL. On
Postgres both URLs may point at the same database: the account tables then live in their own schema
(`web_auth`), which keeps its `users` table apart from the app's.
"""

from collections.abc import Iterator

from sqlalchemy import Engine, MetaData, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from config import get_settings
from database import create_database_engine, is_postgres

WEB_SCHEMA = "web_auth"


def web_schema_for(raw_url: str) -> str | None:
    """The schema the account tables use: one of their own on Postgres, none on SQLite (no schemas there)."""
    return WEB_SCHEMA if is_postgres(raw_url) else None


engine = create_database_engine(get_settings().WEB_AUTH_DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class WebBase(DeclarativeBase):
    metadata = MetaData(schema=web_schema_for(get_settings().WEB_AUTH_DATABASE_URL))


def get_web_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def init_web_db(bind: Engine | None = None) -> None:
    from web_auth import models  # noqa: F401  (registers the tables on WebBase.metadata)

    target = bind or engine
    if WebBase.metadata.schema:
        with target.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {WebBase.metadata.schema}"))
    WebBase.metadata.create_all(target)
