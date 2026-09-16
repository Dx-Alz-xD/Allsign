"""Download public phonetic and speech datasets from Kaggle and seed the phonetic reference tables.

Run from backend/:
    venv/Scripts/python.exe scripts/kaggle_sync.py                   # download what is missing, then seed
    venv/Scripts/python.exe scripts/kaggle_sync.py --include-speech  # also fetch the ~950 MB speech archive
    venv/Scripts/python.exe scripts/kaggle_sync.py --skip-download   # re-seed from backend/data/raw only

Credentials come from KAGGLE_USERNAME / KAGGLE_KEY (environment first, then backend/.env). They are only
needed when something has to be downloaded.

Seeds: phonemes, pronunciations (all of CMUdict), phoneme_trie_nodes (prefix trie over the most frequent
words, for aphasia word-finding cues) and phoneme_target_words (per-phoneme practice words by position).
"""

import argparse
import csv
import json
import logging
import os
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import Engine, delete, insert  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from config import get_settings  # noqa: E402
from database import engine, init_db  # noqa: E402
from models import Phoneme, PhonemeTargetWord, PhonemeTrieNode, Pronunciation  # noqa: E402

log = logging.getLogger("kaggle_sync")

DEFAULT_RAW_DIR = BACKEND_DIR / "data" / "raw"
MANIFEST_NAME = "manifest.json"
CREDENTIAL_VARS = ("KAGGLE_USERNAME", "KAGGLE_KEY")
DEFAULT_TRIE_VOCABULARY = 20_000
DEFAULT_TARGETS_PER_SLOT = 25
POSITIONS = ("initial", "medial", "final")


@dataclass(frozen=True)
class KaggleDataset:
    handle: str
    folder: str
    required_files: tuple[str, ...]
    license: str
    approx_size_mb: float
    speech: bool = False


CMUDICT = KaggleDataset(
    handle="rtatman/cmu-pronouncing-dictionary",
    folder="cmu-pronouncing-dictionary",
    required_files=("cmudict.dict", "cmudict.phones"),
    license="Copyright CMU; free for research and commercial use with acknowledgement (see LICENSE.txt)",
    approx_size_mb=3.6,
)
WORD_FREQUENCY = KaggleDataset(
    handle="rtatman/english-word-frequency",
    folder="english-word-frequency",
    required_files=("unigram_freq.csv",),
    license="Other: MIT-licensed generating code; counts derived from the LDC Google Web Trillion Word Corpus",
    approx_size_mb=5.0,
)
SPEECH_ACCENT_ARCHIVE = KaggleDataset(
    handle="rtatman/speech-accent-archive",
    folder="speech-accent-archive",
    required_files=("reading-passage.txt",),
    license="CC BY-NC-SA (Kaggle lists 4.0, description says 2.0); non-commercial use only",
    approx_size_mb=951.0,
    speech=True,
)
DATASETS = (CMUDICT, WORD_FREQUENCY, SPEECH_ACCENT_ARCHIVE)


class SyncError(Exception):
    """A failure the operator can fix (credentials, missing files); reported without a traceback."""


# ---------------------------------------------------------------------------
# Offensive-word filter
# ---------------------------------------------------------------------------
# The frequency list is scraped web text, so without this filter profanity and slurs would surface as
# word-finding cues and practice words. Stems also catch inflections (fucking, shitty); words whose stem
# would hit ordinary vocabulary (assess, cockpit, dickens, niggle, grape, wankel) are matched whole.
BLOCKED_STEMS = (
    "asshole", "bastard", "bitch", "blowjob", "bollock", "bullshit", "cocksuck", "cunt", "dildo", "fuck",
    "handjob", "hentai", "jizz", "masturbat", "motherfuck", "orgasm", "porn", "shit", "slut", "twat", "whore",
    "xxx",
)
BLOCKED_WORDS = frozenset({
    "anal", "arse", "ass", "asses", "boob", "boobs", "chink", "cock", "cocks", "crap", "crappy", "cum", "damn",
    "damned", "dammit", "dick", "dicks", "dumbass", "dumbasses", "dyke", "fag", "fags", "faggot", "faggots",
    "goddamn", "hell", "homo", "hooker", "jackass", "kike", "milf", "nigga", "niggas", "nigger", "niggers",
    "nude", "nudes", "piss", "pissed", "pissing", "pussies", "pussy", "rape", "raped", "rapes", "raping",
    "rapist", "rapists", "retard", "retarded", "retards", "sex", "sexy", "spic", "tit", "tits", "titties",
    "titty", "tranny", "wank", "wanker", "wankers", "wanking", "wetback",
})


def is_blocked(word: str) -> bool:
    word = word.lower()
    return word in BLOCKED_WORDS or word.startswith(BLOCKED_STEMS)


# ---------------------------------------------------------------------------
# Authentication and download
# ---------------------------------------------------------------------------
def authenticate() -> str:
    """Export Kaggle credentials for kagglehub and verify them. Returns the Kaggle username."""
    settings = get_settings()
    configured = {"KAGGLE_USERNAME": settings.KAGGLE_USERNAME, "KAGGLE_KEY": settings.KAGGLE_KEY.get_secret_value()}
    for name, value in configured.items():
        if value:
            os.environ[name] = value
    missing = [name for name in CREDENTIAL_VARS if not os.environ.get(name)]
    if missing:
        raise SyncError(
            f"Missing {' and '.join(missing)}. Set them in the environment or backend/.env "
            "(Kaggle > Settings > API > Create New Token)."
        )

    import kagglehub
    from kagglehub.exceptions import UnauthenticatedError

    try:
        return kagglehub.whoami(verbose=False)["username"]
    except UnauthenticatedError as exc:
        raise SyncError("Kaggle rejected KAGGLE_USERNAME / KAGGLE_KEY; check the values in backend/.env.") from exc


def missing_files(dataset: KaggleDataset, raw_dir: Path) -> list[str]:
    return [name for name in dataset.required_files if not (raw_dir / dataset.folder / name).is_file()]


def sync_datasets(datasets: Iterable[KaggleDataset], raw_dir: Path, *, force: bool = False) -> list[KaggleDataset]:
    """Download each dataset that is missing (or all with force). Returns the datasets that were downloaded."""
    pending = [dataset for dataset in datasets if force or missing_files(dataset, raw_dir)]
    if not pending:
        log.info("All datasets already present in %s", raw_dir)
        return []

    username = authenticate()
    log.info("Authenticated with Kaggle as %s", username)
    import kagglehub

    raw_dir.mkdir(parents=True, exist_ok=True)
    for dataset in pending:
        target = raw_dir / dataset.folder
        log.info("Downloading %s (~%g MB, %s) -> %s", dataset.handle, dataset.approx_size_mb, dataset.license, target)
        kagglehub.dataset_download(dataset.handle, output_dir=str(target), force_download=force)
        absent = missing_files(dataset, raw_dir)
        if absent:
            raise SyncError(f"{dataset.handle} downloaded without expected file(s): {', '.join(absent)}")
    write_manifest(raw_dir, pending)
    return pending


def write_manifest(raw_dir: Path, downloaded: list[KaggleDataset]) -> None:
    path = raw_dir / MANIFEST_NAME
    manifest = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    synced_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for dataset in downloaded:
        folder = raw_dir / dataset.folder
        manifest[dataset.handle] = {
            "folder": dataset.folder,
            "license": dataset.license,
            "syncedAt": synced_at,
            "files": {
                file.relative_to(folder).as_posix(): file.stat().st_size
                for file in sorted(folder.rglob("*"))
                if file.is_file()
            },
        }
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
_VARIANT = re.compile(r"^(?P<word>.+)\((?P<variant>\d+)\)$")
_WORD = re.compile(r"[a-z][a-z'.\-]*")
_PHONE = re.compile(r"(?P<symbol>[A-Z]{1,2})(?P<stress>[012]?)")
_VOCABULARY_WORD = re.compile(r"[a-z]+(?:'[a-z]+)?")


@dataclass(frozen=True)
class DictionaryEntry:
    word: str
    variant: int
    arpabet: tuple[str, ...]

    @property
    def phonemes(self) -> tuple[str, ...]:
        return tuple(phone.rstrip("012") for phone in self.arpabet)


def parse_phone_classes(path: Path) -> dict[str, str]:
    """cmudict.phones: one 'SYMBOL<tab>class' line per phoneme."""
    classes = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) == 2:
            classes[parts[0].upper()] = parts[1].lower()
    return classes


def parse_cmudict(path: Path, inventory: set[str]) -> tuple[list[DictionaryEntry], int]:
    """Parse cmudict.dict (or the 0.7b layout). Returns entries and the number of lines skipped as invalid."""
    entries: list[DictionaryEntry] = []
    seen: set[tuple[str, int]] = set()
    skipped = 0
    # 0.7b is Latin-1 in places; replacement characters only ever land in words the pattern rejects.
    with path.open(encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.split(" #", 1)[0].strip()
            if not line or line.startswith(";;;"):
                continue
            head, *phones = line.split()
            match = _VARIANT.match(head)
            word, variant = (match["word"], int(match["variant"])) if match else (head, 1)
            word = word.lower()
            arpabet = tuple(phones)
            valid = (
                phones
                and _WORD.fullmatch(word)
                and all(_PHONE.fullmatch(phone) and phone.rstrip("012") in inventory for phone in arpabet)
                and (word, variant) not in seen
            )
            if not valid:
                skipped += 1
                continue
            seen.add((word, variant))
            entries.append(DictionaryEntry(word, variant, arpabet))
    return entries, skipped


def parse_word_frequencies(path: Path) -> dict[str, int]:
    """word -> web count, with blocked words left out so they never rank as suggestions."""
    frequencies: dict[str, int] = {}
    blocked = 0
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            word = (row.get("word") or "").lower()
            if not word:
                continue
            if is_blocked(word):
                blocked += 1
                continue
            frequencies[word] = int(row["count"])
    log.info("Word frequencies: kept %d words, filtered %d offensive entries", len(frequencies), blocked)
    return frequencies


def read_word_list(path: Path | None) -> set[str]:
    if path is None:
        return set()
    words = (line.split("#", 1)[0].strip().lower() for line in path.read_text(encoding="utf-8").splitlines())
    return {word for word in words if word}


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SeedSummary:
    phonemes: int
    pronunciations: int
    skipped_lines: int
    trie_words: int
    trie_nodes: int
    target_words: int


def build_vocabulary(
    entries: list[DictionaryEntry], frequencies: dict[str, int], excluded: set[str], limit: int
) -> list[DictionaryEntry]:
    """Primary pronunciations of the most frequent plain words, most frequent first (limit 0 = all)."""
    candidates = [
        entry
        for entry in entries
        if entry.variant == 1
        and entry.word in frequencies
        and entry.word not in excluded
        and not is_blocked(entry.word)
        and _VOCABULARY_WORD.fullmatch(entry.word)
    ]
    candidates.sort(key=lambda entry: (-frequencies[entry.word], entry.word))
    return candidates[:limit] if limit else candidates


def build_trie(vocabulary: list[DictionaryEntry]) -> tuple[list[dict], dict[DictionaryEntry, int]]:
    """Trie rows in parent-before-child order, plus the terminal node id of each vocabulary entry."""
    nodes: dict[tuple[str, ...], dict] = {
        (): {"id": 1, "parentId": None, "phoneme": None, "depth": 0, "path": "", "wordCount": 0, "topWord": None}
    }
    terminals: dict[DictionaryEntry, int] = {}
    for entry in vocabulary:  # most frequent first, so the first word to reach a node is its top word
        prefix: tuple[str, ...] = ()
        node = nodes[prefix]
        node["wordCount"] += 1
        node["topWord"] = node["topWord"] or entry.word
        for phoneme in entry.phonemes:
            parent_id = node["id"]
            prefix += (phoneme,)
            node = nodes.get(prefix)
            if node is None:
                node = nodes[prefix] = {
                    "id": len(nodes) + 1,
                    "parentId": parent_id,
                    "phoneme": phoneme,
                    "depth": len(prefix),
                    "path": " ".join(prefix),
                    "wordCount": 0,
                    "topWord": entry.word,
                }
            node["wordCount"] += 1
        terminals[entry] = node["id"]
    return list(nodes.values()), terminals


def build_target_words(vocabulary: list[DictionaryEntry], per_slot: int) -> list[tuple[str, str, DictionaryEntry]]:
    """(phoneme, position, entry) rows, at most per_slot per phoneme/position, most frequent words first."""
    slots: dict[tuple[str, str], list[DictionaryEntry]] = {}
    for entry in vocabulary:
        phonemes = entry.phonemes
        if len(phonemes) < 2 or len(entry.word) < 2:
            continue
        for index, phoneme in enumerate(phonemes):
            position = POSITIONS[0] if index == 0 else POSITIONS[2] if index == len(phonemes) - 1 else POSITIONS[1]
            slot = slots.setdefault((phoneme, position), [])
            if len(slot) < per_slot and entry not in slot:
                slot.append(entry)
    return [
        (phoneme, position, entry)
        for (phoneme, position), slot in sorted(slots.items())
        for entry in slot
    ]


def seed_database(
    engine: Engine,
    entries: list[DictionaryEntry],
    phone_classes: dict[str, str],
    frequencies: dict[str, int],
    *,
    trie_vocabulary: int = DEFAULT_TRIE_VOCABULARY,
    targets_per_slot: int = DEFAULT_TARGETS_PER_SLOT,
    excluded: set[str] | None = None,
    skipped_lines: int = 0,
) -> SeedSummary:
    """Replace the phonetic reference tables in a single transaction."""
    vocabulary = build_vocabulary(entries, frequencies, excluded or set(), trie_vocabulary)
    trie_rows, terminals = build_trie(vocabulary)
    targets = build_target_words(vocabulary, targets_per_slot)
    pronunciation_ids = {entry: index for index, entry in enumerate(entries, start=1)}
    ranks: dict[tuple[str, str], int] = {}

    with Session(engine) as session, session.begin():
        for model in (PhonemeTargetWord, Pronunciation, PhonemeTrieNode, Phoneme):
            session.execute(delete(model))
        session.execute(
            insert(Phoneme),
            [{"symbol": symbol, "phonemeClass": phone_class} for symbol, phone_class in sorted(phone_classes.items())],
        )
        session.execute(insert(PhonemeTrieNode), trie_rows)
        session.execute(
            insert(Pronunciation),
            [
                {
                    "id": pronunciation_ids[entry],
                    "word": entry.word,
                    "variant": entry.variant,
                    "arpabet": " ".join(entry.arpabet),
                    "phonemes": " ".join(entry.phonemes),
                    "phonemeCount": len(entry.arpabet),
                    "frequency": frequencies.get(entry.word),
                    "trieNodeId": terminals.get(entry),
                }
                for entry in entries
            ],
        )
        target_rows = []
        for phoneme, position, entry in targets:
            rank = ranks[phoneme, position] = ranks.get((phoneme, position), 0) + 1
            target_rows.append({
                "phoneme": phoneme,
                "position": position,
                "rank": rank,
                "word": entry.word,
                "pronunciationId": pronunciation_ids[entry],
            })
        if target_rows:
            session.execute(insert(PhonemeTargetWord), target_rows)

    return SeedSummary(
        phonemes=len(phone_classes),
        pronunciations=len(entries),
        skipped_lines=skipped_lines,
        trie_words=len(vocabulary),
        trie_nodes=len(trie_rows),
        target_words=len(targets),
    )


def seed_from_raw(
    raw_dir: Path,
    engine: Engine,
    *,
    trie_vocabulary: int = DEFAULT_TRIE_VOCABULARY,
    targets_per_slot: int = DEFAULT_TARGETS_PER_SLOT,
    excluded: set[str] | None = None,
) -> SeedSummary:
    for dataset in (CMUDICT, WORD_FREQUENCY):
        absent = missing_files(dataset, raw_dir)
        if absent:
            raise SyncError(
                f"{raw_dir / dataset.folder} is missing {', '.join(absent)}; run without --skip-download first."
            )
    cmudict_dir = raw_dir / CMUDICT.folder
    phone_classes = parse_phone_classes(cmudict_dir / "cmudict.phones")
    entries, skipped = parse_cmudict(cmudict_dir / "cmudict.dict", set(phone_classes))
    frequencies = parse_word_frequencies(raw_dir / WORD_FREQUENCY.folder / "unigram_freq.csv")
    return seed_database(
        engine,
        entries,
        phone_classes,
        frequencies,
        trie_vocabulary=trie_vocabulary,
        targets_per_slot=targets_per_slot,
        excluded=excluded,
        skipped_lines=skipped,
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR, help="download folder (default: backend/data/raw)")
    parser.add_argument("--include-speech", action="store_true", help="also download the ~950 MB Speech Accent Archive")
    download = parser.add_mutually_exclusive_group()
    download.add_argument("--skip-download", action="store_true", help="only seed from files already in --raw-dir")
    download.add_argument("--force-download", action="store_true", help="re-download datasets even if present")
    parser.add_argument(
        "--trie-vocab", type=int, default=DEFAULT_TRIE_VOCABULARY,
        help=f"most frequent words in the prefix trie and target lists, 0 = all (default: {DEFAULT_TRIE_VOCABULARY})",
    )
    parser.add_argument(
        "--targets-per-slot", type=int, default=DEFAULT_TARGETS_PER_SLOT,
        help=f"practice words per phoneme and position (default: {DEFAULT_TARGETS_PER_SLOT})",
    )
    parser.add_argument(
        "--exclude-words", type=Path, help="file of words (one per line) to keep out of the trie and target lists"
    )
    args = parser.parse_args(argv)
    if args.trie_vocab < 0 or args.targets_per_slot < 1:
        parser.error("--trie-vocab must be >= 0 and --targets-per-slot >= 1")
    return args


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = parse_args(argv)
    datasets = [dataset for dataset in DATASETS if args.include_speech or not dataset.speech]

    try:
        if not args.skip_download:
            sync_datasets(datasets, args.raw_dir, force=args.force_download)
        init_db()
        summary = seed_from_raw(
            args.raw_dir,
            engine,
            trie_vocabulary=args.trie_vocab,
            targets_per_slot=args.targets_per_slot,
            excluded=read_word_list(args.exclude_words),
        )
    except SyncError as exc:
        log.error("kaggle_sync: %s", exc)
        return 2

    log.info(
        "Seeded %s: %d phonemes, %d pronunciations (%d invalid lines skipped), trie of %d words / %d nodes, "
        "%d target words",
        engine.url.render_as_string(hide_password=True),
        summary.phonemes,
        summary.pronunciations,
        summary.skipped_lines,
        summary.trie_words,
        summary.trie_nodes,
        summary.target_words,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
