"""Profiles (usernames, the sign-up interview) and caregiver approval: a room code alone never lets anyone watch."""

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from config import get_settings
from routers import auth, signalling
from web_auth import licenses, tokens
from web_auth.database import WebBase
from web_auth.database import engine as web_engine
from web_auth.models import CaregiverAllowance, LicenseKey, Profile, WebUser

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

PROTOCOL = "voicematics.signal"
PASSWORD = "correct horse battery"
OFFER = {"type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n"}
INTERVIEW = {"role": "myself", "goals": ["type-by-voice", "smoother-speech"], "speech": ["stuttering"], "places": ["work"], "experience": "new", "note": ""}


@pytest.fixture(autouse=True)
def clean(client: "TestClient", monkeypatch):
    WebBase.metadata.drop_all(web_engine)
    WebBase.metadata.create_all(web_engine)
    auth.login_throttle.clear()
    signalling.rooms.clear()
    signalling.pending_alerts.clear()
    monkeypatch.setattr(get_settings(), "REQUIRE_ACCOUNT", True)
    yield
    signalling.rooms.clear()
    signalling.pending_alerts.clear()


def make_user(email: str, tier: str = "free", username: str | None = None) -> tuple[str, dict]:
    key_string = licenses.generate_license_key()
    with Session(web_engine, expire_on_commit=False) as session, session.begin():
        user = WebUser(email=email, passwordHash="$argon2id$unused", planTier=tier, licenseKey=key_string, isActive=True)
        session.add_all([user, LicenseKey(keyString=key_string, user=user, tier=tier)])
        session.flush()
        if username:
            session.add(Profile(userId=user.id, username=username, displayName=username.title()))
    token = tokens.issue_token(user.id, user.email, user.planTier).token
    return token, {"Authorization": f"Bearer {token}"}


def connect(client: "TestClient", role: str, token: str | None, room: str = "ROOM-7"):
    protocols = [PROTOCOL] + ([f"voicematics.token.{token}"] if token else [])
    return client.websocket_connect(f"/ws/signal/{room}?role={role}", subprotocols=protocols)


def closed_with(socket, notice: str | None = None) -> int:
    """The close code, after the approval notice the relay sends first when it turns a caregiver away."""
    if notice is not None:
        assert socket.receive_json() == {"type": "approval", "status": notice, "speaker": None}
    with pytest.raises(WebSocketDisconnect) as closed:
        socket.receive_json()
    return closed.value.code


# ---------------------------------------------------------------------------
# Profiles


def test_signup_keeps_the_chosen_username_and_interview(client: "TestClient"):
    body = {"email": "ada@example.com", "password": PASSWORD, "username": "Ada.Lee", "displayName": "Ada", "onboarding": INTERVIEW}
    created = client.post("/api/auth/signup", json=body)
    assert created.status_code == 201, created.text
    profile = created.json()["profile"]
    assert profile["username"] == "ada.lee" and profile["displayName"] == "Ada"
    assert profile["onboarding"]["goals"] == ["type-by-voice", "smoother-speech"]
    assert profile["onboardingCompletedAt"] is not None

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {created.json()['token']}"}).json()
    assert me["profile"]["username"] == "ada.lee"

    taken = client.post("/api/auth/signup", json={**body, "email": "other@example.com"})
    assert taken.status_code == 409 and "username" in taken.json()["detail"]
    reserved = client.post("/api/auth/signup", json={**body, "email": "third@example.com", "username": "admin"})
    assert reserved.status_code == 422
    # Nothing was created for the refused sign-ups.
    with Session(web_engine) as session:
        assert session.scalars(select(WebUser.email)).all() == ["ada@example.com"]


def test_accounts_without_a_username_get_one(client: "TestClient"):
    created = client.post("/api/auth/signup", json={"email": "Grace.Hopper+x@example.com", "password": PASSWORD}).json()
    assert created["profile"]["username"] == "gracehopperx"
    assert created["profile"]["onboarding"] is None
    token, headers = make_user("gracehopperx@example.org")
    assert client.get("/api/profile", headers=headers).json()["username"].startswith("gracehopperx")


def test_profile_updates_and_username_checks(client: "TestClient"):
    _, headers = make_user("ada@example.com", username="ada")
    make_user("bob@example.com", username="bob")
    assert client.get("/api/profile/username", params={"name": "bob"}).json()["available"] is False
    assert client.get("/api/profile/username", params={"name": "carol"}).json() == {"username": "carol", "available": True, "reason": None}
    assert client.get("/api/profile/username", params={"name": "x"}).json()["available"] is False

    assert client.patch("/api/profile", json={"username": "bob"}, headers=headers).status_code == 409
    assert client.patch("/api/profile", json={"username": "support"}, headers=headers).status_code == 422
    assert client.patch("/api/profile", json={"displayName": "badname"}, headers=headers).status_code == 422
    updated = client.patch("/api/profile", json={"username": "Ada_L", "displayName": "Ada L", "onboarding": INTERVIEW}, headers=headers).json()
    assert (updated["username"], updated["displayName"], updated["onboarding"]["role"]) == ("ada_l", "Ada L", "myself")
    assert client.get("/api/profile").status_code == 401


@pytest.mark.parametrize(
    "hostile",
    ["'; DROP TABLE users; --", "\" OR \"1\"=\"1", "Robert'); DELETE FROM profiles;--", "%' OR 1=1 --", "ada' UNION SELECT password_hash FROM users --"],
)
def test_text_fields_are_stored_as_text_not_sql(client: "TestClient", hostile: str):
    _, headers = make_user("ada@example.com", username="ada")
    make_user("bob@example.com", username="bob")
    saved = client.patch("/api/profile", json={"displayName": hostile[:40], "onboarding": {**INTERVIEW, "note": hostile}}, headers=headers)
    assert saved.status_code == 200
    assert saved.json()["displayName"] == hostile[:40].strip()
    assert saved.json()["onboarding"]["note"] == hostile.strip()
    # A username lookup with the same text finds nothing and breaks nothing.
    assert client.get("/api/profile/username", params={"name": hostile}).json()["available"] is False
    assert client.post("/api/caregivers", json={"username": hostile}, headers=headers).status_code == 422
    login = client.post("/api/auth/login", json={"email": "ada@example.com", "password": hostile})
    assert login.status_code == 401
    with Session(web_engine) as session:
        assert len(session.scalars(select(WebUser)).all()) == 2
        assert len(session.scalars(select(Profile)).all()) == 2


# ---------------------------------------------------------------------------
# Caregiver allowances over REST


def test_speakers_approve_caregivers_by_username(client: "TestClient"):
    _, speaker = make_user("speaker@example.com", "pro", username="speaker1")
    _, free = make_user("free@example.com", "free", username="free1")
    _, caregiver = make_user("carer@example.com", "free", username="carer")

    assert client.post("/api/caregivers", json={"username": "carer"}, headers=free).status_code == 403
    assert client.post("/api/caregivers", json={"username": "nobody"}, headers=speaker).status_code == 404
    assert client.post("/api/caregivers", json={"username": "speaker1"}, headers=speaker).status_code == 400
    added = client.post("/api/caregivers", json={"username": "CARER"}, headers=speaker)
    assert added.status_code == 201
    assert {key: added.json()[key] for key in ("username", "status")} == {"username": "carer", "status": "approved"}

    mine = client.get("/api/caregivers", headers=speaker).json()
    assert [row["username"] for row in mine["caregivers"]] == ["carer"] and mine["speakers"] == []
    theirs = client.get("/api/caregivers", headers=caregiver).json()
    assert [row["username"] for row in theirs["speakers"]] == ["speaker1"] and theirs["caregivers"] == []

    allowance_id = added.json()["id"]
    assert client.post(f"/api/caregivers/{allowance_id}/decision", json={"approve": False}, headers=caregiver).status_code == 404
    assert client.post(f"/api/caregivers/{allowance_id}/decision", json={"approve": False}, headers=speaker).json()["status"] == "denied"
    # Either side may end it.
    assert client.delete(f"/api/caregivers/{allowance_id}", headers=free).status_code == 404
    assert client.delete(f"/api/caregivers/{allowance_id}", headers=caregiver).status_code == 204
    assert client.get("/api/caregivers", headers=speaker).json()["caregivers"] == []


# ---------------------------------------------------------------------------
# The relay


def test_a_room_code_alone_does_not_let_anyone_watch(client: "TestClient"):
    speaker_token, _ = make_user("speaker@example.com", "pro", username="speaker1")
    caregiver_token, caregiver_headers = make_user("carer@example.com", "free", username="carer")

    with connect(client, "caregiver", None) as anonymous:
        assert closed_with(anonymous) == signalling.CLOSE_UNAUTHORIZED

    with connect(client, "speaker", speaker_token) as speaker:
        assert speaker.receive_json()["peerPresent"] is False
        with connect(client, "caregiver", caregiver_token) as caregiver:
            assert caregiver.receive_json() == {"type": "joined", "room": "ROOM-7", "role": "caregiver", "peerPresent": False}
            assert caregiver.receive_json() == {"type": "approval", "status": "pending", "speaker": None}
            request = speaker.receive_json()
            assert request["type"] == "access-request"
            assert (request["request"]["username"], request["request"]["displayName"]) == ("carer", "Carer")

            # Neither side can signal the other yet, and the caregiver learns nothing about the room.
            caregiver.send_json(OFFER)
            assert caregiver.receive_json() == {"type": "error", "message": "Waiting for the speaker's approval."}
            speaker.send_json(OFFER)
            assert speaker.receive_json() == {"type": "error", "message": "No caregiver is in the room yet."}

            speaker.send_json({"type": "access-decision", "id": request["request"]["id"], "approve": True})
            approved = caregiver.receive_json()
            assert approved == {"type": "approval", "status": "approved", "speaker": {"username": "speaker1", "displayName": "Speaker1"}}
            assert caregiver.receive_json() == {"type": "peer-joined", "role": "speaker"}
            assert speaker.receive_json() == {"type": "peer-joined", "role": "caregiver"}
            speaker.send_json(OFFER)
            assert caregiver.receive_json() == OFFER

            # Removing the allowance disconnects the caregiver at once.
            allowance_id = client.get("/api/caregivers", headers=caregiver_headers).json()["speakers"][0]["id"]
            assert client.delete(f"/api/caregivers/{allowance_id}", headers=caregiver_headers).status_code == 204
            assert closed_with(caregiver, "removed") == signalling.CLOSE_FORBIDDEN
        assert speaker.receive_json() == {"type": "peer-left", "role": "caregiver"}


def test_a_denied_caregiver_stays_out_until_approved_by_name(client: "TestClient"):
    speaker_token, speaker_headers = make_user("speaker@example.com", "pro", username="speaker1")
    caregiver_token, _ = make_user("carer@example.com", "free", username="carer")
    with connect(client, "speaker", speaker_token) as speaker:
        speaker.receive_json()
        with connect(client, "caregiver", caregiver_token) as caregiver:
            caregiver.receive_json()
            caregiver.receive_json()  # pending
            request = speaker.receive_json()["request"]
            speaker.send_json({"type": "access-decision", "id": request["id"], "approve": False})
            assert closed_with(caregiver, "denied") == signalling.CLOSE_FORBIDDEN
        with connect(client, "caregiver", caregiver_token) as again:
            again.receive_json()
            assert closed_with(again, "denied") == signalling.CLOSE_FORBIDDEN

        # Approving by username from the account page lets a waiting caregiver straight in.
        assert client.post("/api/caregivers", json={"username": "carer"}, headers=speaker_headers).status_code == 201
        with connect(client, "caregiver", caregiver_token) as allowed:
            assert allowed.receive_json()["type"] == "joined"
            assert allowed.receive_json()["status"] == "approved"
            assert allowed.receive_json() == {"type": "peer-joined", "role": "speaker"}
        assert speaker.receive_json() == {"type": "peer-joined", "role": "caregiver"}
        assert speaker.receive_json() == {"type": "peer-left", "role": "caregiver"}


def test_a_waiting_caregiver_is_reviewed_when_the_speaker_arrives(client: "TestClient"):
    speaker_token, speaker_headers = make_user("speaker@example.com", "pro", username="speaker1")
    caregiver_token, _ = make_user("carer@example.com", "free", username="carer")
    with connect(client, "caregiver", caregiver_token) as caregiver:
        caregiver.receive_json()
        assert caregiver.receive_json() == {"type": "approval", "status": "waiting-for-speaker", "speaker": None}
        with connect(client, "speaker", speaker_token) as speaker:
            assert speaker.receive_json()["peerPresent"] is False
            assert caregiver.receive_json()["status"] == "pending"
            request = speaker.receive_json()["request"]
            assert client.post(f"/api/caregivers/{request['id']}/decision", json={"approve": True}, headers=speaker_headers).status_code == 200
            assert caregiver.receive_json()["status"] == "approved"
            assert caregiver.receive_json() == {"type": "peer-joined", "role": "speaker"}
            assert speaker.receive_json() == {"type": "peer-joined", "role": "caregiver"}


def test_phone_alerts_only_reach_an_approved_caregiver(client: "TestClient"):
    speaker_token, speaker_headers = make_user("speaker@example.com", "pro", username="speaker1")
    caregiver_token, _ = make_user("carer@example.com", "free", username="carer")
    other_token, _ = make_user("other@example.com", "pro", username="other")
    with connect(client, "alerter", speaker_token) as phone:
        assert phone.receive_json()["peerPresent"] is False
        with connect(client, "speaker", other_token) as impostor:
            assert closed_with(impostor) == signalling.CLOSE_FORBIDDEN
        with connect(client, "caregiver", caregiver_token) as caregiver:
            caregiver.receive_json()
            assert caregiver.receive_json()["status"] == "pending"
            phone.send_json({"type": "alert", "kind": "emergency", "message": "Help"})
            sent = phone.receive_json()
            assert sent["delivered"] is False
            allowance = client.get("/api/caregivers", headers=speaker_headers).json()["caregivers"][0]
            assert client.post(f"/api/caregivers/{allowance['id']}/decision", json={"approve": True}, headers=speaker_headers).status_code == 200
            assert caregiver.receive_json()["status"] == "approved"
            held = caregiver.receive_json()
            assert held["type"] == "alert" and held["alert"]["id"] == sent["id"]
            assert phone.receive_json() == {"type": "peer-joined", "role": "caregiver"}


def test_deleting_an_account_removes_its_profile_and_allowances(client: "TestClient"):
    created = client.post("/api/auth/signup", json={"email": "speaker@example.com", "password": PASSWORD, "username": "speaker1"}).json()
    headers = {"Authorization": f"Bearer {created['token']}"}
    with Session(web_engine) as session, session.begin():
        session.get(WebUser, created["user"]["id"]).planTier = "pro"
    make_user("carer@example.com", username="carer")
    assert client.post("/api/caregivers", json={"username": "carer"}, headers=headers).status_code == 201
    assert client.post("/api/auth/me/delete", json={"password": PASSWORD}, headers=headers).status_code == 204
    with Session(web_engine) as session:
        assert session.scalars(select(CaregiverAllowance)).all() == []
        assert [profile.username for profile in session.scalars(select(Profile))] == ["carer"]
