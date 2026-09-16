from pathlib import Path

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import StatementError

from database import Base, SessionLocal, create_database_engine, engine
from models import AcousticTrigger, CustomPhonemeTarget, ProfilePreset, SessionAnalytics, User

OWNED_MODELS = (ProfilePreset, AcousticTrigger, SessionAnalytics, CustomPhonemeTarget)


@pytest.fixture(autouse=True)
def empty_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def make_user() -> User:
    return User(
        displayName="Asha",
        activeProfile="fluency",
        profilePresets=[ProfilePreset(name="Calm reading", mode="fluency", dafDelayMs=60, parameters={"gainDb": -3})],
        acousticTriggers=[AcousticTrigger(name="Clap", spectralFingerprint=[0.25] * 128, mappedPhrase="Help")],
        sessions=[
            SessionAnalytics(
                profileMode="fluency",
                wpm=92.5,
                stutterCount=4,
                avgBlockDurationMs=310.0,
                fluencyPercentage=88.0,
                sessionDurationSeconds=600,
            )
        ],
        phonemeTargets=[CustomPhonemeTarget(phoneme="i", exampleWord="see", f1=270, f2=2290, f3=3010)],
    )


def row_counts(db) -> dict[str, int]:
    return {model.__tablename__: db.scalar(select(func.count()).select_from(model)) for model in OWNED_MODELS}


def test_user_round_trips_with_all_owned_rows() -> None:
    with SessionLocal() as db:
        db.add(make_user())
        db.commit()

    with SessionLocal() as db:
        user = db.scalars(select(User)).one()
        assert user.activeProfile == "fluency"
        assert user.profilePresets[0].parameters == {"gainDb": -3}
        assert user.profilePresets[0].fsfOctaveShift == 0.0
        assert user.acousticTriggers[0].spectralFingerprint == [0.25] * 128
        assert user.acousticTriggers[0].targetAction == "DIRECT_PASTE"
        assert user.sessions[0].fluencyPercentage == 88.0
        assert user.phonemeTargets[0].exampleWord == "see"
        assert all(count == 1 for count in row_counts(db).values())


@pytest.mark.parametrize("via_orm", [True, False], ids=["orm delete", "sql delete"])
def test_deleting_a_user_removes_their_rows(via_orm: bool) -> None:
    with SessionLocal() as db:
        user = make_user()
        db.add_all([user, AcousticTrigger(name="Shared", spectralFingerprint=[0.0] * 128, mappedPhrase="Hi")])
        db.commit()
        if via_orm:
            db.delete(user)
        else:
            # Bypasses the ORM cascade, so this passes only if SQLite enforces ON DELETE CASCADE.
            db.execute(delete(User))
        db.commit()
        assert row_counts(db) == {
            "profile_presets": 0,
            "acoustic_triggers": 1,
            "session_analytics": 0,
            "custom_phoneme_targets": 0,
        }


@pytest.mark.parametrize(
    "row",
    [
        pytest.param(lambda: AcousticTrigger(name="x", spectralFingerprint=[0.0] * 127, mappedPhrase="y"), id="127 bins"),
        pytest.param(
            lambda: AcousticTrigger(name="x", spectralFingerprint=[0.0] * 128, mappedPhrase="y", threshold=2),
            id="threshold",
        ),
        pytest.param(
            lambda: AcousticTrigger(name="x", spectralFingerprint=[0.0] * 128, mappedPhrase="y", targetAction="SHOUT"),
            id="action",
        ),
        pytest.param(lambda: ProfilePreset(name="x", mode="loud"), id="profile mode"),
        pytest.param(
            lambda: SessionAnalytics(
                wpm=90, stutterCount=0, avgBlockDurationMs=0, fluencyPercentage=150, sessionDurationSeconds=60
            ),
            id="fluency over 100",
        ),
        pytest.param(lambda: CustomPhonemeTarget(phoneme="a", f1=0, f2=1200, f3=2500), id="zero formant"),
        pytest.param(
            lambda: AcousticTrigger(
                userId="missing-user", name="x", spectralFingerprint=[0.0] * 128, mappedPhrase="y"
            ),
            id="unknown owner",
        ),
    ],
)
def test_database_rejects_invalid_rows(row) -> None:
    with SessionLocal() as db:
        db.add(row())
        with pytest.raises(StatementError):
            db.commit()


def test_file_database_uses_write_ahead_log_and_foreign_keys(tmp_path: Path) -> None:
    path = tmp_path / "fresh-checkout" / "data" / "omnivoice.db"
    file_engine = create_database_engine(f"sqlite:///{path}")
    try:
        with file_engine.connect() as connection:
            assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
            assert connection.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert path.is_file()
    finally:
        file_engine.dispose()


def test_relative_sqlite_paths_resolve_inside_backend() -> None:
    from database import BACKEND_DIR, resolve_database_url

    assert Path(resolve_database_url("sqlite:///./data/omnivoice.db").database) == BACKEND_DIR / "data" / "omnivoice.db"
    assert resolve_database_url("sqlite://").database in (None, "")
