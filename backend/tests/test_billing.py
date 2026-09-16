"""Mock checkout: plans, card checks, subscription records, plan-tier upgrades and the new licence key."""

import re
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from routers import auth, billing
from web_auth import licenses, tokens
from web_auth.database import WebBase
from web_auth.database import engine as web_engine
from web_auth.models import LicenseKey, Subscription, WebUser

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

KEY_PATTERN = re.compile(r"^VM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")
VISA_OK = "4242 4242 4242 4242"
VISA_DECLINED = "4000 0000 0000 0002"
HARDWARE = "machine-guid-1111-2222"


@pytest.fixture(autouse=True)
def empty_auth_database(client: "TestClient"):
    WebBase.metadata.drop_all(web_engine)
    WebBase.metadata.create_all(web_engine)
    auth.login_throttle.clear()


def make_user(email: str = "ada@example.com", tier: str = "free") -> tuple[WebUser, str, dict]:
    key_string = licenses.generate_license_key()
    with Session(web_engine, expire_on_commit=False) as session, session.begin():
        user = WebUser(email=email, passwordHash="$argon2id$unused", planTier=tier, licenseKey=key_string, isActive=True)
        session.add_all([user, LicenseKey(keyString=key_string, user=user, tier=tier)])
    token = tokens.issue_token(user.id, user.email, user.planTier).token
    return user, key_string, {"Authorization": f"Bearer {token}"}


def card(number: str = VISA_OK, **overrides) -> dict:
    body = {"number": number, "expMonth": 12, "expYear": 2031, "cvc": "123", "name": "Ada Lovelace"}
    body.update(overrides)
    return body


def test_plans_matrix(client: "TestClient"):
    plans = client.get("/api/billing/plans").json()
    assert [(plan["id"], plan["priceCents"], plan["billingPeriod"]) for plan in plans] == [
        ("free", 0, None),
        ("pro_monthly", 1499, "monthly"),
        ("pro_annual", 12900, "annual"),
        ("lifetime", 29900, "lifetime"),
    ]


def test_checkout_needs_a_session(client: "TestClient"):
    response = client.post("/api/billing/checkout", json={"planId": "pro_monthly", "card": card()})
    assert response.status_code == 401


def test_checkout_upgrades_plan_and_issues_a_new_key(client: "TestClient"):
    user, old_key, headers = make_user()
    response = client.post("/api/billing/checkout", json={"planId": "pro_monthly", "card": card()}, headers=headers)
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["user"]["planTier"] == "pro"
    assert body["license"]["tier"] == "pro" and KEY_PATTERN.match(body["license"]["key"])
    assert body["license"]["key"] != old_key
    assert body["subscription"]["planId"] == "pro_monthly"
    assert body["subscription"]["amountCents"] == 1499
    assert body["subscription"]["cardBrand"] == "visa" and body["subscription"]["cardLast4"] == "4242"
    assert body["subscription"]["status"] == "active"
    assert body["subscription"]["currentPeriodEnd"] is not None
    assert body["subscription"]["licenseKey"] == body["license"]["key"]
    assert body["downloadUrl"].endswith("Voicematics-Setup.exe")

    # The full card number is nowhere in the database.
    with Session(web_engine) as session:
        record = session.scalar(select(Subscription))
        assert record is not None and record.cardLast4 == "4242"
        stored_text = {getattr(record, attr) for attr in ("planId", "tier", "billingPeriod", "currency", "cardBrand", "cardLast4", "status", "licenseKey")}
        assert "4242424242424242" not in stored_text
        stored = session.get(WebUser, user.id)
        assert stored.planTier == "pro" and stored.licenseKey == body["license"]["key"]

    # The new key verifies for the desktop app; the old one no longer does.
    fresh = client.post("/api/license/verify", json={"email": user.email, "licenseKey": body["license"]["key"], "hardwareId": HARDWARE}).json()
    assert fresh["valid"] is True and fresh["tier"] == "pro"
    stale = client.post("/api/license/verify", json={"email": user.email, "licenseKey": old_key, "hardwareId": HARDWARE}).json()
    assert stale["valid"] is False and stale["status"] == "inactive"

    # The account endpoints see the upgrade.
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["user"]["planTier"] == "pro" and me["license"]["tier"] == "pro"
    current = client.get("/api/billing/subscription", headers=headers).json()
    assert current["id"] == body["subscription"]["id"]


def test_lifetime_has_no_period_end_and_blocks_further_checkouts(client: "TestClient"):
    _, _, headers = make_user()
    first = client.post("/api/billing/checkout", json={"planId": "lifetime", "card": card("5555 5555 5555 4444")}, headers=headers)
    assert first.status_code == 201
    assert first.json()["subscription"]["currentPeriodEnd"] is None
    assert first.json()["subscription"]["cardBrand"] == "mastercard"
    again = client.post("/api/billing/checkout", json={"planId": "pro_monthly", "card": card()}, headers=headers)
    assert again.status_code == 409


def test_second_checkout_replaces_the_first(client: "TestClient"):
    _, _, headers = make_user()
    monthly = client.post("/api/billing/checkout", json={"planId": "pro_monthly", "card": card()}, headers=headers).json()
    annual = client.post("/api/billing/checkout", json={"planId": "pro_annual", "card": card()}, headers=headers).json()
    assert annual["subscription"]["amountCents"] == 12900
    with Session(web_engine) as session:
        statuses = {row.id: row.status for row in session.scalars(select(Subscription))}
    assert statuses == {monthly["subscription"]["id"]: "replaced", annual["subscription"]["id"]: "active"}
    assert client.get("/api/billing/subscription", headers=headers).json()["id"] == annual["subscription"]["id"]


def test_free_account_has_no_subscription(client: "TestClient"):
    _, _, headers = make_user()
    assert client.get("/api/billing/subscription", headers=headers).json() is None


@pytest.mark.parametrize(
    "payload, detail",
    [
        (card(VISA_DECLINED), "Your card was declined."),
        (card("4242 4242 4242 4241"), "Your card number is invalid."),
        (card(expMonth=1, expYear=2020), "Your card has expired."),
    ],
)
def test_card_problems_answer_402_and_change_nothing(client: "TestClient", payload, detail):
    user, old_key, headers = make_user()
    response = client.post("/api/billing/checkout", json={"planId": "pro_monthly", "card": payload}, headers=headers)
    assert response.status_code == 402
    assert response.json()["detail"] == detail
    with Session(web_engine) as session:
        assert session.scalar(select(Subscription)) is None
        assert session.get(WebUser, user.id).licenseKey == old_key


def test_card_helpers():
    assert billing.luhn_valid("4242424242424242") and not billing.luhn_valid("4242424242424241")
    assert billing.card_brand("4242424242424242") == "visa"
    assert billing.card_brand("378282246310005") == "amex"
    assert billing.card_brand("2223003122003222") == "mastercard"
    assert billing.card_brand("6011111111111117") == "card"


def test_free_plan_is_not_purchasable(client: "TestClient"):
    _, _, headers = make_user()
    response = client.post("/api/billing/checkout", json={"planId": "free", "card": card()}, headers=headers)
    assert response.status_code == 422
