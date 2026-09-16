import json
import math
import struct
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

import acoustic_matcher as am
from database import Base, engine
from tests.test_acoustic_matcher import tone, vowel

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

# Power-spectrum bins with non-trivial decimals, to prove the stored values round-trip exactly.
FINGERPRINT = [10 ** ((math.sin(i / 7) * 40 - 60) / 10) for i in range(128)]


@pytest.fixture(autouse=True)
def empty_database(client: "TestClient"):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def trigger_payload(**overrides) -> dict:
    payload = {
        "name": "Double clap",
        "spectralFingerprint": FINGERPRINT,
        "mappedPhrase": "I need help",
        "targetAction": "TTS_SPOKEN",
        "threshold": 0.9,
    }
    payload.update(overrides)
    return payload


def create_trigger(client: "TestClient", **overrides) -> dict:
    response = client.post("/api/triggers", json=trigger_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_the_saved_trigger(client: "TestClient") -> None:
    created = create_trigger(client)
    assert set(created) == {"id", "name", "spectralFingerprint", "mappedPhrase", "targetAction", "threshold"}
    assert created["spectralFingerprint"] == FINGERPRINT
    assert created == client.get(f"/api/triggers/{created['id']}").json()


def test_create_applies_contract_defaults(client: "TestClient") -> None:
    payload = trigger_payload()
    del payload["targetAction"], payload["threshold"]
    response = client.post("/api/triggers", json=payload)
    assert response.status_code == 201
    assert response.json()["targetAction"] == "DIRECT_PASTE"
    assert response.json()["threshold"] == 0.85


def test_fingerprint_is_stored_as_packed_float64(client: "TestClient") -> None:
    trigger_id = create_trigger(client)["id"]
    with engine.connect() as connection:
        blob = connection.execute(
            text("SELECT spectral_fingerprint FROM acoustic_triggers WHERE id = :id"), {"id": trigger_id}
        ).scalar_one()
    assert len(blob) == 128 * 8
    assert list(struct.unpack("<128d", blob)) == FINGERPRINT


def test_list_filters_by_action_and_paginates(client: "TestClient") -> None:
    actions = ["TTS_SPOKEN", "OS_HOTKEY", "TTS_SPOKEN", "DIRECT_PASTE", "TTS_SPOKEN"]
    ids = {create_trigger(client, name=f"t{i}", targetAction=action)["id"] for i, action in enumerate(actions)}

    everything = client.get("/api/triggers").json()
    assert {trigger["id"] for trigger in everything} == ids

    spoken = client.get("/api/triggers", params={"targetAction": "TTS_SPOKEN"}).json()
    assert len(spoken) == 3 and all(trigger["targetAction"] == "TTS_SPOKEN" for trigger in spoken)

    pages = [client.get("/api/triggers", params={"limit": 2, "offset": offset}).json() for offset in (0, 2, 4)]
    assert [len(page) for page in pages] == [2, 2, 1]
    assert [trigger["id"] for page in pages for trigger in page] == [trigger["id"] for trigger in everything]


def test_put_replaces_every_field(client: "TestClient") -> None:
    trigger_id = create_trigger(client)["id"]
    replacement = trigger_payload(
        name="Tongue click", spectralFingerprint=[0.5] * 128, mappedPhrase="Yes", targetAction="OS_HOTKEY", threshold=0.7
    )
    response = client.put(f"/api/triggers/{trigger_id}", json=replacement)
    assert response.status_code == 200
    assert response.json() == {"id": trigger_id, **replacement}
    assert client.get(f"/api/triggers/{trigger_id}").json() == {"id": trigger_id, **replacement}


def test_patch_changes_only_the_given_fields(client: "TestClient") -> None:
    created = create_trigger(client)
    response = client.patch(f"/api/triggers/{created['id']}", json={"threshold": 0.6, "mappedPhrase": "Water please"})
    assert response.status_code == 200
    assert response.json() == {**created, "threshold": 0.6, "mappedPhrase": "Water please"}
    assert client.get(f"/api/triggers/{created['id']}").json() == response.json()


def test_patch_rejects_explicit_null(client: "TestClient") -> None:
    trigger_id = create_trigger(client)["id"]
    response = client.patch(f"/api/triggers/{trigger_id}", json={"threshold": None})
    assert response.status_code == 422
    assert "threshold" in response.text


def test_delete_removes_the_trigger(client: "TestClient") -> None:
    trigger_id = create_trigger(client)["id"]
    response = client.delete(f"/api/triggers/{trigger_id}")
    assert response.status_code == 204 and response.content == b""
    assert client.get(f"/api/triggers/{trigger_id}").status_code == 404
    assert client.get("/api/triggers").json() == []


@pytest.mark.parametrize(
    "method, body",
    [("get", None), ("put", trigger_payload()), ("patch", {"threshold": 0.5}), ("delete", None)],
)
def test_unknown_trigger_returns_404(client: "TestClient", method: str, body: dict | None) -> None:
    response = client.request(method, "/api/triggers/does-not-exist", json=body)
    assert response.status_code == 404
    assert response.json()["detail"] == "Acoustic trigger 'does-not-exist' not found"


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"spectralFingerprint": [0.0] * 127}, id="127 bins"),
        pytest.param({"spectralFingerprint": [0.0] * 129}, id="129 bins"),
        pytest.param({"spectralFingerprint": [-60.0] * 128}, id="negative bins (dB instead of power)"),
        pytest.param({"targetAction": "SHOUT"}, id="unknown action"),
        pytest.param({"threshold": 1.5}, id="threshold above 1"),
        pytest.param({"threshold": -0.1}, id="negative threshold"),
        pytest.param({"name": ""}, id="empty name"),
        pytest.param({"mappedPhrase": ""}, id="empty phrase"),
    ],
)
def test_invalid_trigger_is_rejected(client: "TestClient", overrides: dict) -> None:
    assert client.post("/api/triggers", json=trigger_payload(**overrides)).status_code == 422
    trigger_id = create_trigger(client)["id"]
    assert client.patch(f"/api/triggers/{trigger_id}", json=overrides).status_code == 422


@pytest.mark.parametrize("bad_bin", [math.nan, math.inf, -math.inf], ids=["NaN", "Infinity", "-Infinity"])
def test_non_finite_fingerprint_is_rejected(client: "TestClient", bad_bin: float) -> None:
    fingerprint = [0.0] * 128
    fingerprint[5] = bad_bin
    # json.dumps writes NaN/Infinity tokens, which the server's JSON decoder accepts, so validation must catch them.
    body = json.dumps(trigger_payload(spectralFingerprint=fingerprint))
    response = client.post("/api/triggers", content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert client.get("/api/triggers").json() == []


# ---------------------------------------------------------------------------
# POST /api/triggers/match
# ---------------------------------------------------------------------------
WHISTLE_QUERY = am.power_spectrum(tone(1610, amplitude=0.1, phase=1.0))


@pytest.fixture
def enrolled(client: "TestClient") -> dict[str, dict]:
    return {
        "whistle": create_trigger(
            client, name="Whistle", spectralFingerprint=am.power_spectrum(tone(1600)),
            mappedPhrase="Help me", targetAction="TTS_SPOKEN",
        ),
        "high": create_trigger(client, name="High whistle", spectralFingerprint=am.power_spectrum(tone(2600))),
        "vowel": create_trigger(
            client, name="Vowel i", spectralFingerprint=am.power_spectrum(vowel(130, [(270, 60), (2290, 100)]))
        ),
    }


def match(client: "TestClient", bins: list[float], **extra) -> dict:
    response = client.post("/api/triggers/match", json={"spectralFingerprint": bins, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_match_fires_the_closest_trigger(client: "TestClient", enrolled: dict) -> None:
    body = match(client, WHISTLE_QUERY)
    assert (body["matched"], body["silent"]) == (True, False)
    assert body["trigger"] == body["candidates"][0]
    assert body["trigger"]["triggerId"] == enrolled["whistle"]["id"]
    assert (body["trigger"]["mappedPhrase"], body["trigger"]["targetAction"]) == ("Help me", "TTS_SPOKEN")
    assert body["trigger"]["score"] >= body["trigger"]["threshold"]
    scores = [candidate["score"] for candidate in body["candidates"]]
    assert len(scores) == 3 and scores == sorted(scores, reverse=True)
    assert all(candidate["distance"] == pytest.approx(1 - candidate["score"]) for candidate in body["candidates"])
    assert body["levelDb"] > am.SILENCE_FLOOR_DB and body["executionLatencyMs"] >= 0


def test_match_honours_top_k_and_the_trigger_threshold(client: "TestClient", enrolled: dict) -> None:
    whistle_id = enrolled["whistle"]["id"]
    assert client.patch(f"/api/triggers/{whistle_id}", json={"threshold": 1.0}).status_code == 200
    body = match(client, WHISTLE_QUERY, topK=1)
    assert (body["matched"], body["trigger"]) == (False, None)
    assert [candidate["triggerId"] for candidate in body["candidates"]] == [whistle_id]
    assert body["candidates"][0]["threshold"] == 1.0


def test_match_sees_fingerprint_edits_and_deletions(client: "TestClient", enrolled: dict) -> None:
    whistle_id = enrolled["whistle"]["id"]

    def scores() -> dict[str, float]:
        return {candidate["triggerId"]: candidate["score"] for candidate in match(client, WHISTLE_QUERY)["candidates"]}

    before = scores()
    moved = client.patch(f"/api/triggers/{whistle_id}", json={"spectralFingerprint": am.power_spectrum(tone(5000))})
    assert moved.status_code == 200
    after = scores()
    assert after[whistle_id] < before[whistle_id] - 0.2
    fired = match(client, WHISTLE_QUERY)["trigger"]
    assert fired is None or fired["triggerId"] != whistle_id

    assert client.delete(f"/api/triggers/{whistle_id}").status_code == 204
    assert whistle_id not in scores() and len(scores()) == 2


def test_match_without_triggers_returns_no_candidates(client: "TestClient") -> None:
    body = match(client, WHISTLE_QUERY)
    assert (body["matched"], body["trigger"], body["candidates"], body["silent"]) == (False, None, [], False)


def test_silent_frames_never_match(client: "TestClient", enrolled: dict) -> None:
    body = match(client, [0.0] * 128)
    assert (body["matched"], body["silent"], body["candidates"]) == (False, True, [])
    assert body["levelDb"] == am.SILENT_DB


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"spectralFingerprint": [0.1] * 127}, id="127 bins"),
        pytest.param({"spectralFingerprint": [-60.0] * 128}, id="negative bins"),
        pytest.param({"spectralFingerprint": [0.1] * 128, "topK": 0}, id="topK 0"),
        pytest.param({"spectralFingerprint": [0.1] * 128, "topK": 21}, id="topK 21"),
        pytest.param({"topK": 3}, id="no fingerprint"),
    ],
)
def test_match_rejects_invalid_requests(client: "TestClient", payload: dict) -> None:
    assert client.post("/api/triggers/match", json=payload).status_code == 422


def test_match_never_creates_triggers(client: "TestClient") -> None:
    response = client.post("/api/triggers/match", json=trigger_payload())
    assert response.status_code == 200 and "matched" in response.json()
    assert client.get("/api/triggers").json() == []


def test_match_sees_edits_made_outside_the_api(client: "TestClient", enrolled: dict) -> None:
    from database import SessionLocal
    from models import AcousticTrigger

    whistle_id = enrolled["whistle"]["id"]
    assert match(client, WHISTLE_QUERY)["trigger"]["triggerId"] == whistle_id  # profiles now cached

    with SessionLocal() as db:
        db.get(AcousticTrigger, whistle_id).spectralFingerprint = am.power_spectrum(tone(5000))
        db.commit()
    fired = match(client, WHISTLE_QUERY)["trigger"]
    assert fired is None or fired["triggerId"] != whistle_id

    with SessionLocal() as db:
        db.delete(db.get(AcousticTrigger, enrolled["high"]["id"]))
        db.commit()
    assert enrolled["high"]["id"] not in {candidate["triggerId"] for candidate in match(client, WHISTLE_QUERY)["candidates"]}
