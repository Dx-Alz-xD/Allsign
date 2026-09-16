import json
import os
import sys
import types
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import Settings
from database import Base, engine
from models import Phoneme, PhonemeTargetWord, PhonemeTrieNode, Pronunciation
from scripts import kaggle_sync
from scripts.kaggle_sync import CMUDICT, SPEECH_ACCENT_ARCHIVE, WORD_FREQUENCY, SyncError

PHONES = """AA\tvowel
AE\tvowel
AH\tvowel
AO\tvowel
B\tstop
D\tstop
EH\tvowel
EY\tvowel
G\tstop
K\tstop
L\tliquid
N\tnasal
NG\tnasal
S\tfricative
T\tstop
Y\tsemivowel
"""

CMUDICT_LINES = """;;; 0.7b-style comment line
a AH0
a(2) EY1
cab K AE1 B
can K AE1 N
can(2) K AH0 N
cat K AE1 T
cat K AE1 T
catalog K AE1 T AH0 L AO2 G
cats K AE1 T S
bat B AE1 T
tab T AE1 B
dog D AO1 G # animal
d'artagnan D AH0 T AA1 NG Y AH0 N # foreign french
kat K AE1 T
bogus K AE1 XX
!exclamation-point EH2 K S K L AH0 M EY1 SH AH0 N P OY2 N T
toto
"""

FREQUENCIES = """word,count
the,23135851162
a,9081174698
can,1022765225
cat,70000000
dog,60000000
cats,40000000
bat,30000000
cab,20000000
tab,10000000
catalog,5000000
d'artagnan,3000
kat,1000
"""

VOCABULARY_BY_FREQUENCY = ["a", "can", "cat", "dog", "cats", "bat", "cab", "tab", "catalog", "d'artagnan", "kat"]


def write_phonetic_raw_data(raw_dir: Path) -> None:
    cmudict_dir = raw_dir / CMUDICT.folder
    cmudict_dir.mkdir(parents=True, exist_ok=True)
    (cmudict_dir / "cmudict.phones").write_text(PHONES, encoding="utf-8")
    (cmudict_dir / "cmudict.dict").write_text(CMUDICT_LINES, encoding="utf-8")
    frequency_dir = raw_dir / WORD_FREQUENCY.folder
    frequency_dir.mkdir(parents=True, exist_ok=True)
    (frequency_dir / "unigram_freq.csv").write_text(FREQUENCIES, encoding="utf-8")


@pytest.fixture(autouse=True)
def empty_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


@pytest.fixture
def raw_dir(tmp_path: Path) -> Path:
    write_phonetic_raw_data(tmp_path)
    return tmp_path


@pytest.fixture
def kaggle_env(monkeypatch: pytest.MonkeyPatch):
    # Blank values (restored after the test) and no .env fallback, so a developer's real key never leaks in.
    for name in kaggle_sync.CREDENTIAL_VARS:
        monkeypatch.setenv(name, "")
    monkeypatch.setattr(kaggle_sync, "get_settings", lambda: Settings(_env_file=None))
    return monkeypatch


class FakeUnauthenticatedError(Exception):
    pass


class FakeKaggleHub:
    def __init__(self, valid_credentials: tuple[str, str] = ("tester", "secret-key")):
        self.valid_credentials = valid_credentials
        self.whoami_calls = 0
        self.downloads: list[tuple[str, str, bool]] = []
        self.omit_files: set[str] = set()

    def whoami(self, *, verbose: bool = True) -> dict:
        self.whoami_calls += 1
        if (os.environ.get("KAGGLE_USERNAME"), os.environ.get("KAGGLE_KEY")) != self.valid_credentials:
            raise FakeUnauthenticatedError("User is not authenticated")
        return {"username": self.valid_credentials[0]}

    def dataset_download(self, handle: str, path=None, *, force_download=False, output_dir=None) -> str:
        self.downloads.append((handle, output_dir, force_download))
        dataset = next(dataset for dataset in kaggle_sync.DATASETS if dataset.handle == handle)
        for name in dataset.required_files:
            if name not in self.omit_files:
                target = Path(output_dir) / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("downloaded", encoding="utf-8")
        return output_dir


@pytest.fixture
def fake_kagglehub(kaggle_env: pytest.MonkeyPatch) -> FakeKaggleHub:
    fake = FakeKaggleHub()
    module = types.ModuleType("kagglehub")
    module.whoami = fake.whoami
    module.dataset_download = fake.dataset_download
    exceptions = types.ModuleType("kagglehub.exceptions")
    exceptions.UnauthenticatedError = FakeUnauthenticatedError
    kaggle_env.setitem(sys.modules, "kagglehub", module)
    kaggle_env.setitem(sys.modules, "kagglehub.exceptions", exceptions)
    return fake


def seed(raw_dir: Path, **options) -> kaggle_sync.SeedSummary:
    return kaggle_sync.seed_from_raw(raw_dir, engine, **options)


def words_under(session: Session, prefix: str) -> list[str]:
    """The trie lookup a word-finding cue would run: vocabulary words at or below a phoneme prefix."""
    query = (
        select(Pronunciation.word)
        .where(Pronunciation.trieNodeId.is_not(None))
        .where((Pronunciation.phonemes == prefix) | Pronunciation.phonemes.between(prefix + " ", prefix + "!"))
        .order_by(Pronunciation.frequency.desc())
    )
    return list(session.scalars(query))


def node(session: Session, path: str) -> PhonemeTrieNode | None:
    return session.scalars(select(PhonemeTrieNode).where(PhonemeTrieNode.path == path)).one_or_none()


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def test_parse_cmudict_handles_variants_comments_and_bad_lines(raw_dir: Path) -> None:
    folder = raw_dir / CMUDICT.folder
    inventory = set(kaggle_sync.parse_phone_classes(folder / "cmudict.phones"))
    entries, skipped = kaggle_sync.parse_cmudict(folder / "cmudict.dict", inventory)

    by_key = {(entry.word, entry.variant): entry for entry in entries}
    assert by_key["can", 2].arpabet == ("K", "AH0", "N")
    assert by_key["can", 2].phonemes == ("K", "AH", "N")
    assert by_key["dog", 1].arpabet == ("D", "AO1", "G")
    assert by_key["d'artagnan", 1].phonemes == ("D", "AH", "T", "AA", "NG", "Y", "AH", "N")
    # duplicate cat, unknown phone XX, punctuation entry, and a word without phones
    assert skipped == 4
    assert len(entries) == 13


def test_parse_cmudict_reads_the_07b_layout(tmp_path: Path) -> None:
    path = tmp_path / "cmudict-0.7b"
    path.write_text(";;; # CMUdict  --  Major Version: 0.07\nCAT  K AE1 T\nCAN(1)  K AH0 N\n", encoding="latin-1")
    entries, skipped = kaggle_sync.parse_cmudict(path, {"K", "AE", "AH", "N", "T"})
    assert [(entry.word, entry.variant, entry.arpabet) for entry in entries] == [
        ("cat", 1, ("K", "AE1", "T")),
        ("can", 1, ("K", "AH0", "N")),
    ]
    assert skipped == 0


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------
def test_seed_populates_phonemes_and_every_pronunciation(raw_dir: Path) -> None:
    summary = seed(raw_dir)
    assert (summary.phonemes, summary.pronunciations, summary.skipped_lines) == (16, 13, 4)
    with Session(engine) as session:
        assert session.get(Phoneme, "NG").phonemeClass == "nasal"
        cat = session.scalars(select(Pronunciation).where(Pronunciation.word == "cat")).one()
        assert (cat.arpabet, cat.phonemes, cat.phonemeCount, cat.frequency) == ("K AE1 T", "K AE T", 3, 70000000)
        alternate = session.scalars(
            select(Pronunciation).where(Pronunciation.word == "can", Pronunciation.variant == 2)
        ).one()
        assert (alternate.phonemes, alternate.frequency, alternate.trieNodeId) == ("K AH N", 1022765225, None)
        assert session.scalar(select(func.count()).where(Pronunciation.word == "bogus")) == 0


def test_trie_nodes_count_words_and_keep_the_most_frequent(raw_dir: Path) -> None:
    summary = seed(raw_dir)
    assert summary.trie_words == len(VOCABULARY_BY_FREQUENCY)
    with Session(engine) as session:
        root = node(session, "")
        assert (root.parentId, root.phoneme, root.depth, root.wordCount, root.topWord) == (None, None, 0, 11, "a")

        k_ae = node(session, "K AE")
        assert (k_ae.phoneme, k_ae.depth, k_ae.wordCount, k_ae.topWord) == ("AE", 2, 6, "can")
        assert node(session, "K").id == k_ae.parentId
        children = session.scalars(
            select(PhonemeTrieNode.phoneme).where(PhonemeTrieNode.parentId == k_ae.id).order_by(PhonemeTrieNode.phoneme)
        )
        assert list(children) == ["B", "N", "T"]

        k_ae_t = node(session, "K AE T")
        assert (k_ae_t.wordCount, k_ae_t.topWord) == (4, "cat")
        homophones = session.scalars(
            select(Pronunciation.word).where(Pronunciation.trieNodeId == k_ae_t.id).order_by(Pronunciation.word)
        )
        assert list(homophones) == ["cat", "kat"]
        assert node(session, "K AH") is None  # only primary pronunciations enter the trie

        assert words_under(session, "K AE") == ["can", "cat", "cats", "cab", "catalog", "kat"]
        assert words_under(session, "K AE T") == ["cat", "cats", "catalog", "kat"]
        assert words_under(session, "D") == ["dog", "d'artagnan"]
        assert session.scalar(select(func.count()).select_from(PhonemeTrieNode)) == summary.trie_nodes


def test_trie_vocabulary_limit_keeps_the_most_frequent_words(raw_dir: Path) -> None:
    summary = seed(raw_dir, trie_vocabulary=3)
    assert summary.trie_words == 3
    with Session(engine) as session:
        assert node(session, "").wordCount == 3
        assert words_under(session, "K AE") == ["can", "cat"]
        assert node(session, "D") is None


def test_target_words_are_ranked_per_phoneme_and_position(raw_dir: Path) -> None:
    seed(raw_dir, targets_per_slot=2)
    with Session(engine) as session:
        def slot(phoneme: str, position: str) -> list[tuple[int, str]]:
            rows = session.execute(
                select(PhonemeTargetWord.rank, PhonemeTargetWord.word)
                .where(PhonemeTargetWord.phoneme == phoneme, PhonemeTargetWord.position == position)
                .order_by(PhonemeTargetWord.rank)
            )
            return [tuple(row) for row in rows]

        assert slot("K", "initial") == [(1, "can"), (2, "cat")]
        assert slot("T", "final") == [(1, "cat"), (2, "bat")]
        assert slot("T", "medial") == [(1, "cats"), (2, "catalog")]
        assert slot("T", "initial") == [(1, "tab")]
        assert slot("AE", "initial") == []
        # single-phoneme words make poor practice targets
        assert session.scalar(select(func.count()).where(PhonemeTargetWord.word == "a")) == 0
        target = session.scalars(select(PhonemeTargetWord).where(PhonemeTargetWord.word == "tab")).first()
        assert session.get(Pronunciation, target.pronunciationId).arpabet == "T AE1 B"


def test_excluded_words_stay_out_of_trie_and_targets(raw_dir: Path) -> None:
    seed(raw_dir, excluded={"cat"})
    with Session(engine) as session:
        assert node(session, "K AE T").topWord == "cats"
        assert "cat" not in words_under(session, "K AE")
        assert session.scalar(select(func.count()).where(PhonemeTargetWord.word == "cat")) == 0
        assert session.scalar(select(func.count()).where(Pronunciation.word == "cat")) == 1


def test_reseeding_replaces_rows_instead_of_duplicating(raw_dir: Path) -> None:
    first = seed(raw_dir)
    second = seed(raw_dir)
    assert first == second
    with Session(engine) as session:
        counts = [
            session.scalar(select(func.count()).select_from(model))
            for model in (Phoneme, Pronunciation, PhonemeTrieNode, PhonemeTargetWord)
        ]
    assert counts == [second.phonemes, second.pronunciations, second.trie_nodes, second.target_words]


def test_seed_reports_missing_raw_files(raw_dir: Path) -> None:
    (raw_dir / WORD_FREQUENCY.folder / "unigram_freq.csv").unlink()
    with pytest.raises(SyncError, match="unigram_freq.csv"):
        seed(raw_dir)


# ---------------------------------------------------------------------------
# Authentication and download
# ---------------------------------------------------------------------------
def test_authenticate_requires_both_variables(fake_kagglehub: FakeKaggleHub, kaggle_env: pytest.MonkeyPatch) -> None:
    kaggle_env.setenv("KAGGLE_USERNAME", "tester")
    with pytest.raises(SyncError, match="Missing KAGGLE_KEY"):
        kaggle_sync.authenticate()
    assert fake_kagglehub.whoami_calls == 0


def test_authenticate_exports_dotenv_values(fake_kagglehub: FakeKaggleHub, kaggle_env: pytest.MonkeyPatch) -> None:
    kaggle_env.setattr(
        kaggle_sync, "get_settings", lambda: Settings(_env_file=None, KAGGLE_USERNAME="tester", KAGGLE_KEY="secret-key")
    )
    assert kaggle_sync.authenticate() == "tester"
    assert (os.environ["KAGGLE_USERNAME"], os.environ["KAGGLE_KEY"]) == ("tester", "secret-key")


def test_rejected_credentials_do_not_echo_the_key(fake_kagglehub: FakeKaggleHub, kaggle_env: pytest.MonkeyPatch) -> None:
    kaggle_env.setenv("KAGGLE_USERNAME", "tester")
    kaggle_env.setenv("KAGGLE_KEY", "wrong-key")
    with pytest.raises(SyncError, match="Kaggle rejected") as error:
        kaggle_sync.authenticate()
    assert "wrong-key" not in str(error.value)


def test_sync_skips_present_datasets_without_authenticating(raw_dir: Path, fake_kagglehub: FakeKaggleHub) -> None:
    assert kaggle_sync.sync_datasets([CMUDICT, WORD_FREQUENCY], raw_dir) == []
    assert fake_kagglehub.whoami_calls == 0 and fake_kagglehub.downloads == []


def test_sync_downloads_only_missing_datasets(
    tmp_path: Path, fake_kagglehub: FakeKaggleHub, kaggle_env: pytest.MonkeyPatch
) -> None:
    kaggle_env.setenv("KAGGLE_USERNAME", "tester")
    kaggle_env.setenv("KAGGLE_KEY", "secret-key")
    write_phonetic_raw_data(tmp_path)
    (tmp_path / WORD_FREQUENCY.folder / "unigram_freq.csv").unlink()

    downloaded = kaggle_sync.sync_datasets([CMUDICT, WORD_FREQUENCY], tmp_path)

    assert downloaded == [WORD_FREQUENCY]
    assert fake_kagglehub.downloads == [(WORD_FREQUENCY.handle, str(tmp_path / WORD_FREQUENCY.folder), False)]
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert list(manifest) == [WORD_FREQUENCY.handle]
    assert manifest[WORD_FREQUENCY.handle]["files"] == {"unigram_freq.csv": len("downloaded")}
    assert manifest[WORD_FREQUENCY.handle]["license"] == WORD_FREQUENCY.license


def test_force_download_refetches_everything(
    raw_dir: Path, fake_kagglehub: FakeKaggleHub, kaggle_env: pytest.MonkeyPatch
) -> None:
    kaggle_env.setenv("KAGGLE_USERNAME", "tester")
    kaggle_env.setenv("KAGGLE_KEY", "secret-key")
    kaggle_sync.sync_datasets([CMUDICT, WORD_FREQUENCY], raw_dir, force=True)
    assert [(handle, force) for handle, _, force in fake_kagglehub.downloads] == [
        (CMUDICT.handle, True),
        (WORD_FREQUENCY.handle, True),
    ]


def test_download_missing_an_expected_file_fails(
    tmp_path: Path, fake_kagglehub: FakeKaggleHub, kaggle_env: pytest.MonkeyPatch
) -> None:
    kaggle_env.setenv("KAGGLE_USERNAME", "tester")
    kaggle_env.setenv("KAGGLE_KEY", "secret-key")
    fake_kagglehub.omit_files = {"cmudict.phones"}
    with pytest.raises(SyncError, match="cmudict.phones"):
        kaggle_sync.sync_datasets([CMUDICT], tmp_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def test_main_seeds_from_existing_files_and_leaves_speech_opt_in(
    raw_dir: Path, fake_kagglehub: FakeKaggleHub, kaggle_env: pytest.MonkeyPatch
) -> None:
    assert kaggle_sync.main(["--raw-dir", str(raw_dir)]) == 0
    assert fake_kagglehub.downloads == []
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Pronunciation)) == 13

    kaggle_env.setenv("KAGGLE_USERNAME", "tester")
    kaggle_env.setenv("KAGGLE_KEY", "secret-key")
    assert kaggle_sync.main(["--raw-dir", str(raw_dir), "--include-speech"]) == 0
    assert [handle for handle, _, _ in fake_kagglehub.downloads] == [SPEECH_ACCENT_ARCHIVE.handle]


def test_main_explains_missing_credentials(
    tmp_path: Path, fake_kagglehub: FakeKaggleHub, caplog: pytest.LogCaptureFixture
) -> None:
    assert kaggle_sync.main(["--raw-dir", str(tmp_path)]) == 2
    assert "Missing KAGGLE_USERNAME and KAGGLE_KEY" in caplog.text


def test_main_skip_download_needs_raw_files(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert kaggle_sync.main(["--raw-dir", str(tmp_path), "--skip-download"]) == 2
    assert "run without --skip-download first" in caplog.text
