import json
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import update

from database import Base, engine
from models import SessionAnalytics

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

SESSION_FIELDS = {
    "id",
    "profileMode",
    "wpm",
    "stutterCount",
    "avgBlockDurationMs",
    "fluencyPercentage",
    "sessionDurationSeconds",
    "recordedAt",
}


@pytest.fixture(autouse=True)
def empty_database(client: "TestClient"):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def session_payload(**overrides) -> dict:
    # The body SessionProvider.recordSession sends (useAudioPipeline.getSessionStats plus the active profile).
    payload = {
        "profileMode": "fluency",
        "wpm": 112.4,
        "stutterCount": 3,
        "avgBlockDurationMs": 640.0,
        "fluencyPercentage": 91.5,
        "sessionDurationSeconds": 95,
    }
    payload.update(overrides)
    return payload


def post_json(client: "TestClient", path: str, payload: dict):
    # json.dumps writes NaN/Infinity tokens, which the test client refuses and the server's decoder accepts.
    return client.post(path, content=json.dumps(payload), headers={"Content-Type": "application/json"})


def record(client: "TestClient", recorded_at: datetime | None = None, **overrides) -> dict:
    response = client.post("/api/sessions", json=session_payload(**overrides))
    assert response.status_code == 201, response.text
    body = response.json()
    if recorded_at is not None:
        # Requests in quick succession can share a timestamp, so ordering tests pin it.
        with engine.begin() as connection:
            connection.execute(
                update(SessionAnalytics).where(SessionAnalytics.id == body["id"]).values(recordedAt=recorded_at)
            )
    return body


def at(minutes: int) -> datetime:
    return datetime(2026, 9, 16, 9, 0, tzinfo=timezone.utc) + timedelta(minutes=minutes)


def test_record_returns_the_saved_session(client: "TestClient") -> None:
    created = record(client)
    assert set(created) == SESSION_FIELDS
    assert {key: created[key] for key in session_payload()} == session_payload()
    assert datetime.fromisoformat(created["recordedAt"]).utcoffset() == timedelta(0)
    assert client.get(f"/api/sessions/{created['id']}").json() == created


def test_sessions_without_a_profile_are_accepted(client: "TestClient") -> None:
    assert record(client, profileMode=None)["profileMode"] is None


def test_list_is_newest_first_and_filters_by_profile(client: "TestClient") -> None:
    oldest = record(client, at(0))
    therapy = record(client, at(1), profileMode="therapy")
    newest = record(client, at(2))
    listed = client.get("/api/sessions").json()
    assert [item["id"] for item in listed] == [newest["id"], therapy["id"], oldest["id"]]
    assert datetime.fromisoformat(listed[0]["recordedAt"]) == at(2)

    fluency = client.get("/api/sessions", params={"profileMode": "fluency"}).json()
    assert [item["id"] for item in fluency] == [newest["id"], oldest["id"]]
    page = client.get("/api/sessions", params={"limit": 1, "offset": 1}).json()
    assert [item["id"] for item in page] == [therapy["id"]]


def test_summary_of_no_sessions_is_all_zero(client: "TestClient") -> None:
    assert client.get("/api/sessions/summary").json() == {
        "profileMode": None,
        "sessions": 0,
        "totalSeconds": 0,
        "totalStutters": 0,
        "averageWpm": 0.0,
        "averageFluencyPercentage": 0.0,
        "averageBlockDurationMs": 0.0,
        "firstRecordedAt": None,
        "lastRecordedAt": None,
    }


def test_summary_weights_by_session_length(client: "TestClient") -> None:
    record(client, at(0), wpm=100, fluencyPercentage=90, stutterCount=2, avgBlockDurationMs=500, sessionDurationSeconds=60)
    record(client, at(5), wpm=140, fluencyPercentage=70, stutterCount=6, avgBlockDurationMs=1000, sessionDurationSeconds=180)
    record(client, at(9), profileMode="therapy", wpm=10, sessionDurationSeconds=1000)
    summary = client.get("/api/sessions/summary", params={"profileMode": "fluency"}).json()
    assert summary["profileMode"] == "fluency"
    assert (summary["sessions"], summary["totalSeconds"], summary["totalStutters"]) == (2, 240, 8)
    assert summary["averageWpm"] == pytest.approx(130)
    assert summary["averageFluencyPercentage"] == pytest.approx(75)
    assert summary["averageBlockDurationMs"] == pytest.approx(875)
    assert datetime.fromisoformat(summary["firstRecordedAt"]) == at(0)
    assert datetime.fromisoformat(summary["lastRecordedAt"]) == at(5)
    assert client.get("/api/sessions/summary").json()["sessions"] == 3


def test_summary_of_zero_length_sessions_uses_plain_means(client: "TestClient") -> None:
    record(client, wpm=90, fluencyPercentage=80, stutterCount=0, sessionDurationSeconds=0)
    record(client, wpm=110, fluencyPercentage=100, stutterCount=0, sessionDurationSeconds=0)
    summary = client.get("/api/sessions/summary").json()
    assert (summary["averageWpm"], summary["averageFluencyPercentage"]) == (100, 90)
    assert summary["averageBlockDurationMs"] == 0


def test_summary_is_not_mistaken_for_a_session_id(client: "TestClient") -> None:
    assert client.get("/api/sessions/summary").status_code == 200
    assert client.delete("/api/sessions/summary").status_code == 404


def test_delete_removes_the_session(client: "TestClient") -> None:
    created = record(client)
    assert client.delete(f"/api/sessions/{created['id']}").status_code == 204
    assert client.get(f"/api/sessions/{created['id']}").status_code == 404
    assert client.delete(f"/api/sessions/{created['id']}").status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"profileMode": "karaoke"},
        {"wpm": -1},
        {"wpm": float("inf")},
        {"stutterCount": -1},
        {"stutterCount": 1.5},
        {"avgBlockDurationMs": -0.1},
        {"fluencyPercentage": 100.1},
        {"sessionDurationSeconds": -5},
    ],
)
def test_invalid_sessions_are_rejected(client: "TestClient", overrides: dict) -> None:
    response = post_json(client, "/api/sessions", session_payload(**overrides))
    assert response.status_code == 422, response.text


def test_list_rejects_unknown_profiles(client: "TestClient") -> None:
    assert client.get("/api/sessions", params={"profileMode": "karaoke"}).status_code == 422
    assert client.get("/api/sessions/summary", params={"profileMode": "karaoke"}).status_code == 422
