import json
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from database import Base, engine

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

PRESET_FIELDS = {"id", "name", "mode", "dafDelayMs", "fsfOctaveShift", "parameters", "createdAt", "updatedAt"}


@pytest.fixture(autouse=True)
def empty_database(client: "TestClient"):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def preset_payload(**overrides) -> dict:
    # The body FluencyPanel.tsx sends when a preset is saved.
    payload = {
        "name": "Slow reading",
        "mode": "fluency",
        "dafDelayMs": 75,
        "fsfOctaveShift": -0.25,
        "parameters": {"feedbackGain": 0.8},
    }
    payload.update(overrides)
    return payload


def post_json(client: "TestClient", path: str, payload: dict):
    # json.dumps writes NaN/Infinity tokens, which the test client refuses and the server's decoder accepts.
    return client.post(path, content=json.dumps(payload), headers={"Content-Type": "application/json"})


def create_preset(client: "TestClient", **overrides) -> dict:
    response = client.post("/api/presets", json=preset_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def assert_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    assert parsed.utcoffset() == timedelta(0), value
    return parsed


def test_create_returns_the_saved_preset(client: "TestClient") -> None:
    created = create_preset(client, name="  Slow reading  ")
    assert set(created) == PRESET_FIELDS
    assert created["name"] == "Slow reading"
    assert (created["dafDelayMs"], created["fsfOctaveShift"]) == (75, -0.25)
    assert created["parameters"] == {"feedbackGain": 0.8}
    assert_utc(created["createdAt"])
    assert created == client.get(f"/api/presets/{created['id']}").json()


def test_timestamps_stay_utc_after_a_reload(client: "TestClient") -> None:
    created = create_preset(client)
    [listed] = client.get("/api/presets").json()
    assert assert_utc(listed["createdAt"]) == assert_utc(created["createdAt"])
    assert assert_utc(listed["updatedAt"]) == assert_utc(created["updatedAt"])


def test_optional_fields_default_to_off(client: "TestClient") -> None:
    response = client.post("/api/presets", json={"name": "Plain", "mode": "clearvoice"})
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["dafDelayMs"], body["fsfOctaveShift"], body["parameters"]) == (0, 0, {})


def test_list_filters_by_mode_in_creation_order(client: "TestClient") -> None:
    first = create_preset(client, name="First")
    create_preset(client, name="Therapy", mode="therapy")
    last = create_preset(client, name="Last")
    names = [preset["name"] for preset in client.get("/api/presets", params={"mode": "fluency"}).json()]
    assert names == [first["name"], last["name"]]
    assert len(client.get("/api/presets").json()) == 3
    assert client.get("/api/presets", params={"limit": 1, "offset": 1}).json()[0]["name"] == "Therapy"
    assert client.get("/api/presets", params={"mode": "karaoke"}).status_code == 422


def test_put_replaces_every_field(client: "TestClient") -> None:
    created = create_preset(client)
    replacement = {"name": "Quiet room", "mode": "sensory", "dafDelayMs": 0, "fsfOctaveShift": 0.5}
    response = client.put(f"/api/presets/{created['id']}", json=replacement)
    assert response.status_code == 200, response.text
    body = response.json()
    assert {key: body[key] for key in replacement} == replacement
    assert body["parameters"] == {}
    assert body["createdAt"] == created["createdAt"]
    assert assert_utc(body["updatedAt"]) >= assert_utc(created["updatedAt"])
    assert client.get(f"/api/presets/{created['id']}").json() == body


def test_missing_presets_return_404(client: "TestClient") -> None:
    assert client.get("/api/presets/nope").status_code == 404
    assert client.put("/api/presets/nope", json=preset_payload()).status_code == 404
    assert client.delete("/api/presets/nope").status_code == 404


def test_delete_removes_the_preset(client: "TestClient") -> None:
    created = create_preset(client)
    response = client.delete(f"/api/presets/{created['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/api/presets/{created['id']}").status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},
        {"name": "x" * 101},
        {"mode": "karaoke"},
        {"dafDelayMs": -1},
        {"dafDelayMs": 151},
        {"fsfOctaveShift": 0.6},
        {"fsfOctaveShift": -0.6},
        {"parameters": {"nested": {"gain": 1}}},
        {"parameters": {"gain": float("nan")}},
        {"parameters": {f"key{i}": i for i in range(33)}},
        {"parameters": {"": 1}},
    ],
)
def test_invalid_presets_are_rejected(client: "TestClient", overrides: dict) -> None:
    response = post_json(client, "/api/presets", preset_payload(**overrides))
    assert response.status_code == 422, response.text


def test_parameters_keep_their_json_types(client: "TestClient") -> None:
    parameters = {"gain": 1.25, "steps": 3, "enabled": True, "voice": "calm", "unset": None}
    created = create_preset(client, parameters=parameters)
    stored = client.get(f"/api/presets/{created['id']}").json()["parameters"]
    assert stored == parameters
    assert [type(stored[key]) for key in parameters] == [float, int, bool, str, type(None)]
