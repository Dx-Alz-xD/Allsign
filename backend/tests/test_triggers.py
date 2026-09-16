import json
import math
import struct
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

from database import Base, engine

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

# dB-like FFT magnitudes with non-trivial decimals, to prove the stored values round-trip exactly.
FINGERPRINT = [math.sin(i / 7) * 40 - 60 for i in range(128)]


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
