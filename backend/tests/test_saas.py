"""The SaaS layer: entitlements per plan, subscription expiry and cancellation, device deactivation, and
per-account isolation of triggers, presets, sessions and phoneme targets."""

from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import database
from models import AcousticTrigger, CustomPhonemeTarget, ProfilePreset, SessionAnalytics, User, utcnow
from routers import auth
from routers.triggers import profile_cache
from web_auth import licenses, tokens
from web_auth.database import WebBase
from web_auth.database import engine as web_engine
from web_auth.models import LicenseKey, Subscription, WebUser
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
    assert {"fluency", "therapy", "unlimited_triggers", "caregiver_link", "analytics", "clinical_reports"} <= set(PLAN_FEATURES["pro"])


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
    _, _, ada = make_user("ada@example.com")
    _, _, bob = make_user("bob@example.com")
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
