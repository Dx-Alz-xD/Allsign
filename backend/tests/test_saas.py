"""The SaaS layer: entitlements per plan, subscription expiry and cancellation, device deactivation, and
per-account isolation of triggers, presets, sessions and phoneme targets."""

from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect
from sqlalchemy.orm import Session

import database
from config import get_settings
from models import AcousticTrigger, CustomPhonemeTarget, ProfilePreset, SessionAnalytics, User, utcnow
from routers import auth
from routers.triggers import profile_cache
from web_auth import licenses, tokens
from web_auth.database import WebBase
from web_auth.database import engine as web_engine
from web_auth.models import DeviceSession, LicenseKey, Subscription, WebUser
from web_auth.plans import FREE_TRIGGER_LIMIT, PLAN_FEATURES

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

HARDWARE_A = "machine-guid-aaaa-1111"
HARDWARE_B = "machine-guid-bbbb-2222"
FINGERPRINT = [0.5] * 128


@pytest.fixture(autouse=True)
def clean_databases(client: "TestClient"):
    WebBase.metadata.drop_all(web_engine)
    WebBase.metadata.create_all(web_engine)
    auth.login_throttle.clear()
    profile_cache.clear()
    with Session(database.engine) as session, session.begin():
        for model in (AcousticTrigger, ProfilePreset, SessionAnalytics, CustomPhonemeTarget, User):
            for row in session.scalars(select(model)):
                session.delete(row)
    yield
    profile_cache.clear()


def make_user(email: str, tier: str = "free") -> tuple[WebUser, str, dict]:
    key_string = licenses.generate_license_key()
    with Session(web_engine, expire_on_commit=False) as session, session.begin():
        user = WebUser(email=email, passwordHash="$argon2id$unused", planTier=tier, licenseKey=key_string, isActive=True)
        session.add_all([user, LicenseKey(keyString=key_string, user=user, tier=tier)])
    token = tokens.issue_token(user.id, user.email, user.planTier).token
    return user, key_string, {"Authorization": f"Bearer {token}"}


def subscribe(client: "TestClient", headers: dict, plan: str = "pro_monthly") -> dict:
    card = {"number": "4242 4242 4242 4242", "expMonth": 12, "expYear": 2031, "cvc": "123", "name": "Ada"}
    response = client.post("/api/billing/checkout", json={"planId": plan, "card": card}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def trigger_body(name: str) -> dict:
    return {"name": name, "spectralFingerprint": FINGERPRINT, "mappedPhrase": "hello", "targetAction": "TTS_SPOKEN", "threshold": 0.85}


# ---------------------------------------------------------------------------
# Entitlements


def test_plan_feature_sets():
    assert "fluency" not in PLAN_FEATURES["free"] and "clearvoice" in PLAN_FEATURES["free"]
    assert set(PLAN_FEATURES["pro"]) == set(PLAN_FEATURES["lifetime"])
    assert {"fluency", "therapy", "unlimited_triggers", "caregiver_link", "analytics"} <= set(PLAN_FEATURES["pro"])


def test_checkout_unlocks_pro_features_everywhere(client: "TestClient"):
    user, key, headers = make_user("ada@example.com")
    before = client.post("/api/license/verify", json={"email": user.email, "licenseKey": key, "hardwareId": HARDWARE_A}).json()
    assert before["tier"] == "free" and before["triggerLimit"] == FREE_TRIGGER_LIMIT and "fluency" not in before["features"]

    body = subscribe(client, headers)
    assert body["entitlements"]["tier"] == "pro" and body["entitlements"]["triggerLimit"] is None
    assert body["entitlements"]["expiresAt"] is not None

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["entitlements"]["tier"] == "pro" and "caregiver_link" in me["entitlements"]["features"]

    after = client.post("/api/license/verify", json={"email": user.email, "licenseKey": body["license"]["key"], "hardwareId": HARDWARE_A}).json()
    assert after["valid"] and after["tier"] == "pro" and "fluency" in after["features"] and after["expiresAt"] is not None


def test_lapsed_subscription_drops_to_free(client: "TestClient"):
    user, _, headers = make_user("ada@example.com")
    body = subscribe(client, headers)
    with Session(web_engine) as session, session.begin():
        record = session.get(Subscription, body["subscription"]["id"])
        record.currentPeriodEnd = utcnow() - timedelta(days=1)

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["entitlements"]["tier"] == "free" and me["user"]["planTier"] == "free"
    assert client.get("/api/billing/subscription", headers=headers).json() is None
    with Session(web_engine) as session:
        assert session.get(Subscription, body["subscription"]["id"]).status == "expired"
    verified = client.post("/api/license/verify", json={"email": user.email, "licenseKey": body["license"]["key"]}).json()
    assert verified["valid"] and verified["tier"] == "free" and "fluency" not in verified["features"]


def test_cancel_keeps_access_until_the_period_ends(client: "TestClient"):
    _, _, headers = make_user("ada@example.com")
    body = subscribe(client, headers)
    cancelled = client.post("/api/billing/cancel", headers=headers)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["entitlements"]["tier"] == "pro"
    assert client.get("/api/billing/subscription", headers=headers).json()["id"] == body["subscription"]["id"]
    assert client.post("/api/billing/cancel", headers=headers).status_code == 200  # idempotent

    _, _, lifetime_headers = make_user("grace@example.com")
    subscribe(client, lifetime_headers, "lifetime")
    assert client.post("/api/billing/cancel", headers=lifetime_headers).status_code == 409
    _, _, free_headers = make_user("free@example.com")
    assert client.post("/api/billing/cancel", headers=free_headers).status_code == 404


def test_deactivate_lets_another_machine_activate(client: "TestClient"):
    user, key, headers = make_user("ada@example.com")
    first = client.post("/api/license/verify", json={"email": user.email, "licenseKey": key, "hardwareId": HARDWARE_A}).json()
    assert first["valid"] and first["hardwareBound"]
    other = client.post("/api/license/verify", json={"email": user.email, "licenseKey": key, "hardwareId": HARDWARE_B}).json()
    assert not other["valid"] and other["status"] == "hardware_mismatch"

    released = client.post("/api/license/deactivate", headers=headers)
    assert released.status_code == 200 and released.json()["hardwareBound"] is False
    assert client.get("/api/auth/me", headers=headers).json()["license"]["hardwareBound"] is False
    moved = client.post("/api/license/verify", json={"email": user.email, "licenseKey": key, "hardwareId": HARDWARE_B}).json()
    assert moved["valid"] and moved["hardwareBound"]
    assert client.post("/api/license/deactivate").status_code == 401


# ---------------------------------------------------------------------------
# Per-account data


def test_triggers_are_isolated_per_account(client: "TestClient"):
    _, _, ada = make_user("ada@example.com")
    _, _, bob = make_user("bob@example.com")

    mine = client.post("/api/triggers", json=trigger_body("Ada hum"), headers=ada).json()
    theirs = client.post("/api/triggers", json=trigger_body("Bob hum"), headers=bob).json()
    local = client.post("/api/triggers", json=trigger_body("Local hum")).json()

    assert [t["name"] for t in client.get("/api/triggers", headers=ada).json()] == ["Ada hum"]
    assert [t["name"] for t in client.get("/api/triggers", headers=bob).json()] == ["Bob hum"]
    assert [t["name"] for t in client.get("/api/triggers").json()] == ["Local hum"]

    # Another account's row is invisible, not forbidden.
    assert client.get(f"/api/triggers/{theirs['id']}", headers=ada).status_code == 404
    assert client.patch(f"/api/triggers/{theirs['id']}", json={"threshold": 0.5}, headers=ada).status_code == 404
    assert client.delete(f"/api/triggers/{theirs['id']}", headers=ada).status_code == 404
    assert client.get(f"/api/triggers/{local['id']}", headers=ada).status_code == 404
    assert client.get(f"/api/triggers/{mine['id']}").status_code == 404

    # Matching only ranks the caller's own triggers.
    match = client.post("/api/triggers/match", json={"spectralFingerprint": FINGERPRINT, "topK": 5}, headers=ada).json()
    assert [c["name"] for c in match["candidates"]] == ["Ada hum"]
    anonymous = client.post("/api/triggers/match", json={"spectralFingerprint": FINGERPRINT, "topK": 5}).json()
    assert [c["name"] for c in anonymous["candidates"]] == ["Local hum"]

    # The account is mirrored into the app database so the foreign key holds.
    with Session(database.engine) as session:
        names = {row.displayName for row in session.scalars(select(User))}
    assert {"ada@example.com", "bob@example.com"} <= names


def test_presets_sessions_and_targets_are_isolated(client: "TestClient"):
    _, _, ada = make_user("ada@example.com", "pro")
    _, _, bob = make_user("bob@example.com", "pro")
    preset = {"name": "Reading", "mode": "fluency", "dafDelayMs": 60, "fsfOctaveShift": -0.5, "parameters": {}}
    session_body = {"profileMode": "fluency", "wpm": 120, "stutterCount": 2, "avgBlockDurationMs": 500, "fluencyPercentage": 95, "sessionDurationSeconds": 60}
    target = {"phoneme": "i", "exampleWord": "beet", "f1": 270, "f2": 2290, "f3": 3010}

    created = client.post("/api/presets", json=preset, headers=ada).json()
    client.post("/api/presets", json={**preset, "name": "Bob preset"}, headers=bob)
    assert [p["name"] for p in client.get("/api/presets", headers=ada).json()] == ["Reading"]
    assert client.get(f"/api/presets/{created['id']}", headers=bob).status_code == 404
    assert client.get("/api/presets").json() == []

    recorded = client.post("/api/sessions", json=session_body, headers=ada).json()
    client.post("/api/sessions", json={**session_body, "wpm": 200}, headers=bob)
    assert [s["id"] for s in client.get("/api/sessions", headers=ada).json()] == [recorded["id"]]
    assert client.get("/api/sessions/summary", headers=ada).json()["sessions"] == 1
    assert client.get("/api/sessions/summary").json()["sessions"] == 0
    assert client.delete(f"/api/sessions/{recorded['id']}", headers=bob).status_code == 404

    made = client.post("/api/phonemes/targets", json=target, headers=ada).json()
    assert [t["id"] for t in client.get("/api/phonemes/targets", headers=ada).json()] == [made["id"]]
    assert client.get("/api/phonemes/targets", headers=bob).json() == []
    assert client.delete(f"/api/phonemes/targets/{made['id']}", headers=bob).status_code == 404
    assert client.delete(f"/api/phonemes/targets/{made['id']}", headers=ada).status_code == 204


def test_bad_or_disabled_tokens_are_rejected(client: "TestClient"):
    assert client.get("/api/triggers", headers={"Authorization": "Bearer not-a-token"}).status_code == 401
    user, _, headers = make_user("off@example.com")
    with Session(web_engine) as session, session.begin():
        session.get(WebUser, user.id).isActive = False
    assert client.get("/api/triggers", headers=headers).status_code == 401


# ---------------------------------------------------------------------------
# Enforcement (REQUIRE_ACCOUNT on, as on the hosted service)

PRESET = {"name": "Reading", "mode": "fluency", "dafDelayMs": 60, "fsfOctaveShift": -0.5, "parameters": {}}
SESSION = {"profileMode": "clearvoice", "wpm": 120, "stutterCount": 0, "avgBlockDurationMs": 0, "fluencyPercentage": 100, "sessionDurationSeconds": 60}
TARGET = {"phoneme": "i", "exampleWord": "beet", "f1": 270, "f2": 2290, "f3": 3010}
SIGNAL_PROTOCOL = "voicematics.signal"


@pytest.fixture
def accounts_required(monkeypatch):
    monkeypatch.setattr(get_settings(), "REQUIRE_ACCOUNT", True)


def signal_close_code(client: "TestClient", role: str, token: str | None = None) -> int | None:
    """The close code the relay answers a join with, or None when the join was accepted."""
    protocols = [SIGNAL_PROTOCOL] + ([f"voicematics.token.{token}"] if token else [])
    with client.websocket_connect(f"/ws/signal/ROOM-1?role={role}&client=device-0001", subprotocols=protocols) as socket:
        try:
            message = socket.receive_json()
        except WebSocketDisconnect as closed:
            return closed.code
        assert message["type"] == "joined"
        assert socket.accepted_subprotocol == SIGNAL_PROTOCOL
        return None


def bearer(headers: dict) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


@pytest.mark.usefixtures("accounts_required")
def test_app_data_needs_a_session(client: "TestClient"):
    for method, path, body in [
        ("get", "/api/triggers", None),
        ("post", "/api/triggers", trigger_body("hum")),
        ("post", "/api/triggers/match", {"spectralFingerprint": FINGERPRINT, "topK": 1}),
        ("get", "/api/presets", None),
        ("post", "/api/presets", PRESET),
        ("get", "/api/sessions", None),
        ("post", "/api/sessions", SESSION),
        ("get", "/api/phonemes/targets", None),
    ]:
        response = client.request(method.upper(), path, json=body)
        assert response.status_code == 401, (path, response.text)
        assert response.headers["www-authenticate"] == "Bearer"

    # The speech path, the word finder, pricing and the refiner's status stay public.
    assert client.post("/api/grammar/translate", json={"rawSpeechTokens": ["me", "want", "water"]}).status_code == 200
    assert client.get("/api/phonemes/lookup", params={"prefix": ""}).status_code == 200
    assert client.get("/api/billing/plans").status_code == 200
    assert client.get("/api/agent/status").status_code == 200
    assert client.get("/health/live").status_code == 200


@pytest.mark.usefixtures("accounts_required")
def test_free_plan_limits(client: "TestClient"):
    _, _, free = make_user("free@example.com")

    first = client.post("/api/triggers", json=trigger_body("hum"), headers=free)
    assert first.status_code == 201
    second = client.post("/api/triggers", json=trigger_body("click"), headers=free)
    assert second.status_code == 403 and "Voicematics Pro" in second.json()["detail"]
    # Editing the one trigger a Free plan keeps is still allowed.
    assert client.patch(f"/api/triggers/{first.json()['id']}", json={"threshold": 0.7}, headers=free).status_code == 200

    assert client.post("/api/presets", json=PRESET, headers=free).status_code == 403
    assert client.post("/api/presets", json={**PRESET, "mode": "therapy"}, headers=free).status_code == 403
    assert client.post("/api/presets", json={**PRESET, "mode": "clearvoice", "dafDelayMs": 0, "fsfOctaveShift": 0}, headers=free).status_code == 201
    assert client.get("/api/presets", headers=free).status_code == 200

    assert client.get("/api/sessions", headers=free).status_code == 403
    assert client.post("/api/sessions", json=SESSION, headers=free).status_code == 403
    assert client.get("/api/sessions/summary", headers=free).status_code == 403
    assert client.get("/api/phonemes/targets", headers=free).status_code == 403
    assert client.post("/api/phonemes/targets", json=TARGET, headers=free).status_code == 403


@pytest.mark.usefixtures("accounts_required")
def test_upgrade_unlocks_and_a_lapse_locks_again(client: "TestClient"):
    _, _, headers = make_user("ada@example.com")
    assert client.post("/api/sessions", json=SESSION, headers=headers).status_code == 403

    body = subscribe(client, headers)
    assert client.post("/api/sessions", json=SESSION, headers=headers).status_code == 201
    assert client.post("/api/presets", json=PRESET, headers=headers).status_code == 201
    assert client.post("/api/phonemes/targets", json=TARGET, headers=headers).status_code == 201
    for name in ("one", "two", "three"):
        assert client.post("/api/triggers", json=trigger_body(name), headers=headers).status_code == 201

    with Session(web_engine) as session, session.begin():
        session.get(Subscription, body["subscription"]["id"]).currentPeriodEnd = utcnow() - timedelta(minutes=1)

    # The same token: the plan is settled on every request, not read from the token.
    assert client.get("/api/sessions", headers=headers).status_code == 403
    assert client.post("/api/triggers", json=trigger_body("four"), headers=headers).status_code == 403
    # Triggers made on Pro are kept and listed, but only the oldest one within the Free limit is matched.
    assert [t["name"] for t in client.get("/api/triggers", headers=headers).json()] == ["one", "two", "three"]
    match = client.post("/api/triggers/match", json={"spectralFingerprint": FINGERPRINT, "topK": 5}, headers=headers).json()
    assert [c["name"] for c in match["candidates"]] == ["one"]


@pytest.mark.usefixtures("accounts_required")
def test_caregiver_relay_needs_pro_for_the_speaker(client: "TestClient"):
    _, _, free = make_user("free@example.com")
    _, _, pro = make_user("pro@example.com", "pro")

    assert signal_close_code(client, "speaker") == 4401
    assert signal_close_code(client, "speaker", "not-a-token") == 4401
    assert signal_close_code(client, "speaker", bearer(free)) == 4402
    assert signal_close_code(client, "speaker", bearer(pro)) is None
    # The caregiver can watch without an account, but a token that is sent must be valid.
    assert signal_close_code(client, "caregiver") is None
    assert signal_close_code(client, "caregiver", "not-a-token") == 4401


def test_local_mode_keeps_every_feature(client: "TestClient"):
    assert get_settings().REQUIRE_ACCOUNT is False
    for name in ("one", "two"):
        assert client.post("/api/triggers", json=trigger_body(name)).status_code == 201
    assert client.post("/api/sessions", json=SESSION).status_code == 201
    assert client.post("/api/presets", json=PRESET).status_code == 201
    assert signal_close_code(client, "speaker") is None
    # A Free account's token still gets Free limits in local mode.
    _, _, free = make_user("free@example.com")
    assert client.post("/api/sessions", json=SESSION, headers=free).status_code == 403
    assert signal_close_code(client, "speaker", bearer(free)) == 4402


def test_sentence_refiner_needs_a_signed_in_account_when_accounts_are_required(client: "TestClient", monkeypatch):
    from agents import sentence_refiner
    from routers import agents as agent_routes

    monkeypatch.setattr(agent_routes, "require_model", lambda *_: object())
    monkeypatch.setattr(sentence_refiner, "refine_sentence", lambda request, model: {"text": "I want water.", "modelName": "test"})
    agent_routes.refine_rate_limiter.clear()
    refine = {"rawTokens": ["me", "water", "want"], "draft": "I want water."}

    _, _, free = make_user("free@example.com")
    # ClearVoice is free, and so is its second answer.
    assert client.post("/api/agent/refine-sentence", json=refine, headers=free).status_code == 200

    monkeypatch.setattr(get_settings(), "REQUIRE_ACCOUNT", True)
    assert client.post("/api/agent/refine-sentence", json=refine).status_code == 401


# ---------------------------------------------------------------------------
# Remembered computers


def test_a_remembered_computer_gets_fresh_sessions_until_it_signs_out(client: "TestClient"):
    user, _, headers = make_user("ada@example.com", "pro")
    assert client.post("/api/auth/devices", json={"hardwareId": HARDWARE_A}).status_code == 401

    registered = client.post("/api/auth/devices", json={"hardwareId": HARDWARE_A, "label": "Linux desktop"}, headers=headers)
    assert registered.status_code == 201
    device_token = registered.json()["deviceToken"]
    with Session(web_engine) as session:
        stored = session.scalars(select(DeviceSession)).one()
        # Neither the secret nor the raw machine id is stored.
        assert device_token not in (stored.secretHash, stored.hardwareFingerprint) and stored.hardwareFingerprint != HARDWARE_A

    fresh = client.post("/api/auth/devices/session", json={"deviceToken": device_token, "hardwareId": HARDWARE_A})
    assert fresh.status_code == 200
    body = fresh.json()
    assert body["user"]["id"] == user.id and body["entitlements"]["tier"] == "pro"
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"}).status_code == 200

    # The token is useless on another machine, and every failure looks the same.
    other = client.post("/api/auth/devices/session", json={"deviceToken": device_token, "hardwareId": HARDWARE_B})
    unknown = client.post("/api/auth/devices/session", json={"deviceToken": "x" * 43, "hardwareId": HARDWARE_A})
    assert other.status_code == unknown.status_code == 401 and other.json() == unknown.json()

    assert client.post("/api/auth/devices/revoke", json={"deviceToken": device_token}).status_code == 204
    assert client.post("/api/auth/devices/revoke", json={"deviceToken": device_token}).status_code == 204
    assert client.post("/api/auth/devices/session", json={"deviceToken": device_token, "hardwareId": HARDWARE_A}).status_code == 401


def test_disabled_accounts_and_old_devices_lose_their_sessions(client: "TestClient"):
    user, _, headers = make_user("ada@example.com")
    tokens_issued = [
        client.post("/api/auth/devices", json={"hardwareId": f"machine-{index:04d}"}, headers=headers).json()["deviceToken"]
        for index in range(auth.MAX_DEVICES + 1)
    ]
    # Registering one computer past the limit signed the least recently used one out.
    assert client.post("/api/auth/devices/session", json={"deviceToken": tokens_issued[0], "hardwareId": "machine-0000"}).status_code == 401
    assert client.post("/api/auth/devices/session", json={"deviceToken": tokens_issued[-1], "hardwareId": f"machine-{auth.MAX_DEVICES:04d}"}).status_code == 200

    with Session(web_engine) as session, session.begin():
        session.get(WebUser, user.id).isActive = False
    assert client.post("/api/auth/devices/session", json={"deviceToken": tokens_issued[-1], "hardwareId": f"machine-{auth.MAX_DEVICES:04d}"}).status_code == 401


def test_deleting_an_account_erases_everything_saved_with_it(client: "TestClient"):
    user, _, headers = make_user("ada@example.com", "pro")
    with Session(web_engine) as session, session.begin():
        session.get(WebUser, user.id).passwordHash = auth.hash_password("correct horse battery")
    _, _, other = make_user("bob@example.com", "pro")
    subscribe(client, headers)
    client.post("/api/auth/devices", json={"hardwareId": HARDWARE_A}, headers=headers)
    client.post("/api/triggers", json=trigger_body("hum"), headers=headers)
    client.post("/api/presets", json={"name": "Reading", "mode": "fluency", "dafDelayMs": 60, "fsfOctaveShift": 0, "parameters": {}}, headers=headers)
    client.post("/api/triggers", json=trigger_body("Bob hum"), headers=other)

    assert client.post("/api/auth/me/delete", json={"password": "correct horse battery"}).status_code == 401
    wrong = client.post("/api/auth/me/delete", json={"password": "wrong password"}, headers=headers)
    assert wrong.status_code == 403
    assert client.get("/api/auth/me", headers=headers).status_code == 200

    assert client.post("/api/auth/me/delete", json={"password": "correct horse battery"}, headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    with Session(web_engine) as session:
        assert session.scalars(select(LicenseKey).where(LicenseKey.userId == user.id)).all() == []
        assert session.scalars(select(Subscription).where(Subscription.userId == user.id)).all() == []
        assert session.scalars(select(DeviceSession).where(DeviceSession.userId == user.id)).all() == []
    with Session(database.engine) as session:
        assert session.get(User, user.id) is None
        assert session.scalars(select(AcousticTrigger).where(AcousticTrigger.userId == user.id)).all() == []
        assert session.scalars(select(ProfilePreset).where(ProfilePreset.userId == user.id)).all() == []
    # Other accounts are untouched.
    assert [t["name"] for t in client.get("/api/triggers", headers=other).json()] == ["Bob hum"]
