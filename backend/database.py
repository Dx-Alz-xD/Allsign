from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import URL, Engine, create_engine, event, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from config import get_settings

BACKEND_DIR = Path(__file__).resolve().parent


def _is_sqlite_memory(url: URL) -> bool:
    return url.get_backend_name() == "sqlite" and url.database in (None, "", ":memory:")


def resolve_database_url(raw_url: str) -> URL:
    """Anchor relative SQLite paths to backend/ so the DB file doesn't depend on the launch directory, and
    route Postgres URLs (as hosts hand them out: postgres:// or postgresql://) through the psycopg driver."""
    url = make_url(raw_url)
    if url.get_backend_name() == "sqlite" and not _is_sqlite_memory(url) and not Path(url.database).is_absolute():
        url = url.set(database=str(BACKEND_DIR / url.database))
    if url.drivername in ("postgres", "postgresql"):
        url = url.set(drivername="postgresql+psycopg")
    return url


def is_postgres(raw_url: str) -> bool:
    return make_url(raw_url).get_backend_name() in ("postgres", "postgresql")


def _engine_options(url: URL) -> dict:
    if url.get_backend_name() != "sqlite":
        # Hosted Postgres (Render, Neon) closes idle connections and may pause the database: check a pooled
        # connection before use and retire it after five minutes.
        return {"pool_pre_ping": True, "pool_recycle": 300}
    options: dict = {"connect_args": {"check_same_thread": False}}
    if _is_sqlite_memory(url):
        # One shared connection, otherwise every pooled connection sees its own empty database.
        options["poolclass"] = StaticPool
    return options


def _sqlite_connection_setup(write_ahead_log: bool):
    def configure(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        # SQLite ignores FOREIGN KEY / ON DELETE CASCADE unless this is set on every connection.
        cursor.execute("PRAGMA foreign_keys=ON")
        if write_ahead_log:
            # WAL skips creating and deleting a rollback journal per commit: on Windows a fully synced
            # commit drops from ~15-20 ms to ~3-5 ms, and readers no longer block the writer.
            cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return configure


def create_database_engine(raw_url: str) -> Engine:
    url = resolve_database_url(raw_url)
    if url.get_backend_name() == "sqlite" and not _is_sqlite_memory(url):
        # SQLite creates the file but not its folder (e.g. a fresh checkout without backend/data/).
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    new_engine = create_engine(url, **_engine_options(url))
    if new_engine.dialect.name == "sqlite":
        event.listen(new_engine, "connect", _sqlite_connection_setup(write_ahead_log=not _is_sqlite_memory(url)))
    return new_engine


engine = create_database_engine(get_settings().DATABASE_URL)


# expire_on_commit=False lets endpoints return committed rows without a reload query.
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def init_db(bind: Engine | None = None) -> None:
    import models  # noqa: F401  (registers the tables on Base.metadata)

    Base.metadata.create_all(bind or engine)
