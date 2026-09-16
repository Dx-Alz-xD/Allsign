"""SQLite store for website accounts and desktop licences.

It is a separate file from omnivoice.db: account data has its own lifecycle, and the app's data exports and
benchmarks never touch it. Relative paths resolve against backend/, like DATABASE_URL.
"""

from collections.abc import Iterator

from sqlalchemy import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from config import get_settings
from database import create_database_engine

engine = create_database_engine(get_settings().WEB_AUTH_DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class WebBase(DeclarativeBase):
    pass


def get_web_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def init_web_db(bind: Engine | None = None) -> None:
    from web_auth import models  # noqa: F401  (registers the tables on WebBase.metadata)

    WebBase.metadata.create_all(bind or engine)
