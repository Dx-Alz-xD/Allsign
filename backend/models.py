"""SQLAlchemy ORM models.

Attribute names are camelCase to match schemas.py / shared/types.ts, so Pydantic's from_attributes
reads rows directly; database column names stay snake_case.
"""

import struct
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, get_args

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from database import Base
from schemas import FINGERPRINT_BINS, ProfileMode, TriggerAction

WordPosition = Literal["initial", "medial", "final"]


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FloatArray(TypeDecorator):
    """Fixed-length float list stored as packed little-endian float64 (8 bytes per value, exact round-trip)."""

    impl = LargeBinary
    cache_ok = True

    def __init__(self, length: int):
        super().__init__()
        self.length = length
        self._codec = struct.Struct(f"<{length}d")

    def process_bind_param(self, value: Any, dialect) -> bytes | None:
        if value is None:
            return None
        if len(value) != self.length:
            raise ValueError(f"expected {self.length} floats, got {len(value)}")
        return self._codec.pack(*value)

    def process_result_value(self, value: bytes | None, dialect) -> list[float] | None:
        return None if value is None else list(self._codec.unpack(value))


def choice(literal_type: Any, name: str) -> Enum:
    # SQLite has no native enum: VARCHAR plus a CHECK constraint over the allowed values.
    return Enum(*get_args(literal_type), name=name, native_enum=False, create_constraint=True)


def owner_column() -> Mapped[str | None]:
    # Nullable: rows without an owner are shared defaults for the local install.
    return mapped_column("user_id", ForeignKey("users.id", ondelete="CASCADE"), index=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    displayName: Mapped[str] = mapped_column("display_name", String(100))
    activeProfile: Mapped[str] = mapped_column(
        "active_profile", choice(ProfileMode, "ck_users_active_profile"), default="clearvoice"
    )
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)

    profilePresets: Mapped[list["ProfilePreset"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    acousticTriggers: Mapped[list["AcousticTrigger"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    sessions: Mapped[list["SessionAnalytics"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    phonemeTargets: Mapped[list["CustomPhonemeTarget"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class ProfilePreset(Base):
    """Saved DSP settings for one ProfileMode (DAF delay and FSF shift from FluencyMetrics, plus extras)."""

    __tablename__ = "profile_presets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    userId: Mapped[str | None] = owner_column()
    name: Mapped[str] = mapped_column(String(100))
    mode: Mapped[str] = mapped_column(choice(ProfileMode, "ck_profile_presets_mode"))
    dafDelayMs: Mapped[float] = mapped_column("daf_delay_ms", Float, default=0.0)
    fsfOctaveShift: Mapped[float] = mapped_column("fsf_octave_shift", Float, default=0.0)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)
    updatedAt: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped[User | None] = relationship(back_populates="profilePresets")

    __table_args__ = (CheckConstraint("daf_delay_ms >= 0", name="ck_profile_presets_daf_delay"),)


class AcousticTrigger(Base):
    """A micro-acoustic AAC trigger: a 128-bin FFT fingerprint mapped to a phrase and an action."""

    __tablename__ = "acoustic_triggers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    userId: Mapped[str | None] = owner_column()
    name: Mapped[str] = mapped_column(String(100))
    spectralFingerprint: Mapped[list[float]] = mapped_column(
        "spectral_fingerprint", FloatArray(FINGERPRINT_BINS)
    )
    mappedPhrase: Mapped[str] = mapped_column("mapped_phrase", String(500))
    targetAction: Mapped[str] = mapped_column(
        "target_action", choice(TriggerAction, "ck_acoustic_triggers_target_action"), default="DIRECT_PASTE"
    )
    threshold: Mapped[float] = mapped_column(Float, default=0.85)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)
    updatedAt: Mapped[datetime] = mapped_column(
        "updated_at", DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped[User | None] = relationship(back_populates="acousticTriggers")

    __table_args__ = (
        CheckConstraint("threshold >= 0 AND threshold <= 1", name="ck_acoustic_triggers_threshold"),
    )


class SessionAnalytics(Base):
    """Per-session fluency metrics; fields mirror SessionAnalyticsOut in schemas.py."""

    __tablename__ = "session_analytics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    userId: Mapped[str | None] = owner_column()
    profileMode: Mapped[str | None] = mapped_column(
        "profile_mode", choice(ProfileMode, "ck_session_analytics_profile_mode")
    )
    wpm: Mapped[float] = mapped_column(Float)
    stutterCount: Mapped[int] = mapped_column("stutter_count", Integer)
    avgBlockDurationMs: Mapped[float] = mapped_column("avg_block_duration_ms", Float)
    fluencyPercentage: Mapped[float] = mapped_column("fluency_percentage", Float)
    sessionDurationSeconds: Mapped[int] = mapped_column("session_duration_seconds", Integer)
    recordedAt: Mapped[datetime] = mapped_column(
        "recorded_at", DateTime(timezone=True), default=utcnow, index=True
    )

    user: Mapped[User | None] = relationship(back_populates="sessions")

    __table_args__ = (
        CheckConstraint("wpm >= 0", name="ck_session_analytics_wpm"),
        CheckConstraint("stutter_count >= 0", name="ck_session_analytics_stutter_count"),
        CheckConstraint("avg_block_duration_ms >= 0", name="ck_session_analytics_avg_block"),
        CheckConstraint(
            "fluency_percentage >= 0 AND fluency_percentage <= 100", name="ck_session_analytics_fluency"
        ),
        CheckConstraint("session_duration_seconds >= 0", name="ck_session_analytics_duration"),
    )


class CustomPhonemeTarget(Base):
    """Articulation target formants for one phoneme; f1-f3 mirror FormantData in shared/types.ts."""

    __tablename__ = "custom_phoneme_targets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    userId: Mapped[str | None] = owner_column()
    phoneme: Mapped[str] = mapped_column(String(16))
    exampleWord: Mapped[str | None] = mapped_column("example_word", String(64))
    f1: Mapped[float] = mapped_column(Float)
    f2: Mapped[float] = mapped_column(Float)
    f3: Mapped[float] = mapped_column(Float)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)

    user: Mapped[User | None] = relationship(back_populates="phonemeTargets")

    __table_args__ = (
        CheckConstraint("f1 > 0 AND f2 > 0 AND f3 > 0", name="ck_custom_phoneme_targets_formants"),
    )


# ---------------------------------------------------------------------------
# Phonetic reference data, seeded by scripts/kaggle_sync.py from CMUdict and web word frequencies.
# ---------------------------------------------------------------------------
class Phoneme(Base):
    """ARPAbet phoneme inventory (cmudict.phones)."""

    __tablename__ = "phonemes"

    symbol: Mapped[str] = mapped_column(String(4), primary_key=True)
    phonemeClass: Mapped[str | None] = mapped_column("phoneme_class", String(16))


class PhonemeTrieNode(Base):
    """One node of the phonemic prefix trie behind aphasia word-finding cues.

    `path` is the space-joined, stress-free phoneme prefix ("" for the root). The words under a node are
    the pronunciations whose `phonemes` equal `path` or fall in the index range [path + " ", path + "!").
    `wordCount` counts the trie vocabulary below the node and `topWord` is its most frequent word.
    """

    __tablename__ = "phoneme_trie_nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    parentId: Mapped[int | None] = mapped_column(
        "parent_id", ForeignKey("phoneme_trie_nodes.id", ondelete="CASCADE"), index=True
    )
    phoneme: Mapped[str | None] = mapped_column(ForeignKey("phonemes.symbol"))
    depth: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String(200), unique=True)
    wordCount: Mapped[int] = mapped_column("word_count", Integer)
    topWord: Mapped[str | None] = mapped_column("top_word", String(64))


class Pronunciation(Base):
    """A CMUdict pronunciation. `trieNodeId` is set when the word is part of the trie vocabulary."""

    __tablename__ = "pronunciations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    word: Mapped[str] = mapped_column(String(64), index=True)
    variant: Mapped[int] = mapped_column(Integer, default=1)
    arpabet: Mapped[str] = mapped_column(String(200))
    phonemes: Mapped[str] = mapped_column(String(200), index=True)
    phonemeCount: Mapped[int] = mapped_column("phoneme_count", Integer)
    frequency: Mapped[int | None] = mapped_column(BigInteger)
    trieNodeId: Mapped[int | None] = mapped_column(
        "trie_node_id", ForeignKey("phoneme_trie_nodes.id", ondelete="SET NULL"), index=True
    )

    __table_args__ = (UniqueConstraint("word", "variant", name="uq_pronunciations_word_variant"),)


class PhonemeTargetWord(Base):
    """Articulation target dictionary: frequency-ranked practice words for a phoneme in one word position."""

    __tablename__ = "phoneme_target_words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phoneme: Mapped[str] = mapped_column(ForeignKey("phonemes.symbol"))
    position: Mapped[str] = mapped_column(choice(WordPosition, "ck_phoneme_target_words_position"))
    rank: Mapped[int] = mapped_column(Integer)
    word: Mapped[str] = mapped_column(String(64))
    pronunciationId: Mapped[int] = mapped_column(
        "pronunciation_id", ForeignKey("pronunciations.id", ondelete="CASCADE")
    )

    __table_args__ = (
        UniqueConstraint("phoneme", "position", "rank", name="uq_phoneme_target_words_slot_rank"),
        UniqueConstraint("phoneme", "position", "word", name="uq_phoneme_target_words_slot_word"),
    )
