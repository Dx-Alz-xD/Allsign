import json
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from database import Base, engine
from scripts import kaggle_sync
from tests.test_kaggle_sync import VOCABULARY_BY_FREQUENCY, write_phonetic_raw_data

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

TARGET_FIELDS = {"id", "phoneme", "exampleWord", "f1", "f2", "f3", "createdAt"}


@pytest.fixture(autouse=True)
def empty_database(client: "TestClient"):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


@pytest.fixture
def seeded(tmp_path: Path) -> None:
    write_phonetic_raw_data(tmp_path)
    kaggle_sync.seed_from_raw(tmp_path, engine)


def post_json(client: "TestClient", path: str, payload: dict):
    # json.dumps writes NaN/Infinity tokens, which the test client refuses and the server's decoder accepts.
    return client.post(path, content=json.dumps(payload), headers={"Content-Type": "application/json"})


def lookup(client: "TestClient", prefix: str, **params) -> dict:
    response = client.get("/api/phonemes/lookup", params={"prefix": prefix, **params})
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Custom articulation targets
# ---------------------------------------------------------------------------
def test_create_target_returns_the_saved_target(client: "TestClient") -> None:
    # The body TherapyPanel.tsx sends when the current vowel is saved.
    response = client.post(
        "/api/phonemes/targets", json={"phoneme": " i ", "exampleWord": None, "f1": 280, "f2": 2250, "f3": 2890}
    )
    assert response.status_code == 201, response.text
    created = response.json()
    assert set(created) == TARGET_FIELDS
    assert (created["phoneme"], created["exampleWord"], created["f1"], created["f2"], created["f3"]) == (
        "i", None, 280, 2250, 2890,
    )
    assert client.get("/api/phonemes/targets").json() == [created]


def test_targets_are_listed_in_creation_order_and_deleted(client: "TestClient") -> None:
    ids = [
        client.post("/api/phonemes/targets", json={"phoneme": symbol, "exampleWord": word, "f1": f1, "f2": f2, "f3": 2500}).json()["id"]
        for symbol, word, f1, f2 in [("i", "heed", 280, 2250), ("u", None, 310, 870), ("AA", "hod", 710, 1100)]
    ]
    assert [target["id"] for target in client.get("/api/phonemes/targets").json()] == ids
    assert client.delete(f"/api/phonemes/targets/{ids[1]}").status_code == 204
    assert [target["id"] for target in client.get("/api/phonemes/targets").json()] == [ids[0], ids[2]]
    assert client.delete(f"/api/phonemes/targets/{ids[1]}").status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"phoneme": "  "},
        {"phoneme": "x" * 17},
        {"exampleWord": ""},
        {"f1": 0},
        {"f2": -100},
        {"f3": 8001},
        {"f1": float("nan")},
    ],
)
def test_invalid_targets_are_rejected(client: "TestClient", overrides: dict) -> None:
    payload = {"phoneme": "i", "f1": 280, "f2": 2250, "f3": 2890, **overrides}
    assert post_json(client, "/api/phonemes/targets", payload).status_code == 422


# ---------------------------------------------------------------------------
# Word-finding lookup
# ---------------------------------------------------------------------------
def test_lookup_without_a_seeded_dictionary_finds_nothing(client: "TestClient") -> None:
    empty = {"found": False, "wordCount": 0, "words": [], "next": []}
    assert lookup(client, "") == {"prefix": [], **empty}
    assert lookup(client, "w ao") == {"prefix": ["W", "AO"], **empty}


def test_empty_prefix_describes_the_whole_vocabulary(client: "TestClient", seeded: None) -> None:
    result = lookup(client, "", limit=3)
    assert (result["prefix"], result["found"], result["wordCount"]) == ([], True, len(VOCABULARY_BY_FREQUENCY))
    assert [word["word"] for word in result["words"]] == VOCABULARY_BY_FREQUENCY[:3]
    assert [(branch["phoneme"], branch["wordCount"], branch["topWord"]) for branch in result["next"]] == [
        ("K", 6, "can"),
        ("D", 2, "dog"),
        ("AH", 1, "a"),
        ("B", 1, "bat"),
        ("T", 1, "tab"),
    ]


def test_prefix_lists_frequent_words_and_next_sounds(client: "TestClient", seeded: None) -> None:
    result = lookup(client, "k ae1")
    assert result["prefix"] == ["K", "AE"]
    assert (result["found"], result["wordCount"]) == (True, 6)
    assert [word["word"] for word in result["words"]] == ["can", "cat", "cats", "cab", "catalog", "kat"]
    assert result["words"][1] == {"word": "cat", "arpabet": "K AE1 T", "frequency": 70000000}
    assert [(branch["phoneme"], branch["wordCount"], branch["topWord"]) for branch in result["next"]] == [
        ("T", 4, "cat"),
        ("B", 1, "cab"),
        ("N", 1, "can"),
    ]


def test_prefix_accepts_commas_and_extra_spaces(client: "TestClient", seeded: None) -> None:
    assert lookup(client, "  K,AE ,  T ") == lookup(client, "K AE T")
    assert [word["word"] for word in lookup(client, "K AE T")["words"]] == ["cat", "cats", "catalog", "kat"]


def test_leaf_prefix_has_no_next_sounds(client: "TestClient", seeded: None) -> None:
    result = lookup(client, "K AE T S")
    assert (result["found"], result["wordCount"], result["next"]) == (True, 1, [])
    assert [word["word"] for word in result["words"]] == ["cats"]


def test_limit_caps_words_but_keeps_branches(client: "TestClient", seeded: None) -> None:
    result = lookup(client, "K AE", limit=0)
    assert result["words"] == []
    assert len(result["next"]) == 3
    assert [word["word"] for word in lookup(client, "K AE", limit=2)["words"]] == ["can", "cat"]


def test_prefix_outside_the_trie_is_not_found(client: "TestClient", seeded: None) -> None:
    # "can" has a K AH N variant, but only primary pronunciations are in the trie.
    assert lookup(client, "K AH") == {"prefix": ["K", "AH"], "found": False, "wordCount": 0, "words": [], "next": []}


@pytest.mark.parametrize("prefix", ["ZH", "K @", "wa", "K AE T S S S " + "K " * 30])
def test_invalid_prefixes_explain_the_problem(client: "TestClient", seeded: None, prefix: str) -> None:
    response = client.get("/api/phonemes/lookup", params={"prefix": prefix})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_lookup_checks_query_bounds(client: "TestClient") -> None:
    assert client.get("/api/phonemes/lookup", params={"limit": 51}).status_code == 422
    assert client.get("/api/phonemes/lookup", params={"prefix": "K " * 101}).status_code == 422
