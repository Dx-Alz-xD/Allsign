import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

import jwt
import pytest
from argon2 import PasswordHasher, Type, extract_parameters
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

import database
from config import Settings
from routers import auth
from web_auth import licenses, passwords, tokens
from web_auth.database import WebBase
from web_auth.database import engine as web_engine
from web_auth.models import LicenseKey, WebUser
from web_auth.throttle import LoginThrottle

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

PASSWORD = "correct horse battery staple"
KEY_PATTERN = re.compile(r"^VM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")
HARDWARE = "machine-guid-1111-2222"


@pytest.fixture(autouse=True)
def empty_auth_database(client: "TestClient"):
    WebBase.metadata.drop_all(web_engine)
    WebBase.metadata.create_all(web_engine)
    auth.login_throttle.clear()


@lru_cache(maxsize=1)
def stored_hash() -> str:
    return passwords.hash_password(PASSWORD)


def make_user(email: str = "ada@example.com", *, active: bool = True, tier: str = "free", password_hash: str | None = None):
    """An account written straight to the database, reusing one hash so tests stay fast."""
    key_string = licenses.generate_license_key()
    with Session(web_engine, expire_on_commit=False) as session, session.begin():
        user = WebUser(email=email, passwordHash=password_hash or stored_hash(), planTier=tier, licenseKey=key_string, isActive=active)
        session.add_all([user, LicenseKey(keyString=key_string, user=user, tier=tier)])
    return user, key_string


def signup(client: "TestClient", email: str = "Ada@Example.com", password: str = PASSWORD):
    return client.post("/api/auth/signup", json={"email": email, "password": password})


def login(client: "TestClient", email: str = "ada@example.com", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def verify(client: "TestClient", email: str, key: str, hardware: str | None = HARDWARE) -> dict:
    body = {"email": email, "licenseKey": key}
    if hardware is not None:
        body["hardwareId"] = hardware
    response = client.post("/api/license/verify", json=body)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Argon2id helpers
# ---------------------------------------------------------------------------
def test_hashes_use_argon2id_with_the_required_parameters() -> None:
    encoded = passwords.hash_password(PASSWORD)
    params = extract_parameters(encoded)
    assert encoded.startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    assert (params.type, params.time_cost, params.memory_cost, params.parallelism) == (Type.ID, 3, 65536, 4)
    assert (params.salt_len, params.hash_len) == (16, 32)


def test_verify_password_accepts_only_the_right_password() -> None:
    encoded = stored_hash()
    assert passwords.verify_password(PASSWORD, encoded) is True
    assert passwords.verify_password(PASSWORD + " ", encoded) is False
    assert passwords.verify_password(PASSWORD, "not a hash") is False
    assert passwords.verify_password(PASSWORD, "") is False
    # A fresh salt every time.
    assert passwords.hash_password(PASSWORD) != encoded


def test_hashes_with_other_parameters_need_a_rehash() -> None:
    weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
    assert passwords.needs_rehash(weak.hash(PASSWORD)) is True
    assert passwords.needs_rehash(stored_hash()) is False


# ---------------------------------------------------------------------------
# License keys and tokens
# ---------------------------------------------------------------------------
def test_license_keys_are_random_and_well_formed() -> None:
    keys = {licenses.generate_license_key() for _ in range(500)}
    assert len(keys) == 500
    assert all(KEY_PATTERN.fullmatch(key) for key in keys)
    key = next(iter(keys))
    assert licenses.normalise_license_key(f"  {key.lower()} ") == key
    for bad in ["VM-0000-AAAA-BBBB", "VM-AAAA-BBBB", "XX-AAAA-BBBB-CCCC", "VM-AAAA-BBBB-CCCC-DDDD", ""]:
        assert licenses.normalise_license_key(bad) is None


def test_hardware_ids_are_stored_as_sha256() -> None:
    fingerprint = licenses.hardware_fingerprint(f"  {HARDWARE} ")
    assert re.fullmatch(r"[0-9a-f]{64}", fingerprint)
    assert fingerprint == licenses.hardware_fingerprint(HARDWARE)
    assert HARDWARE not in fingerprint


def test_tokens_round_trip_and_reject_tampering() -> None:
    session = tokens.issue_token("user-1", "ada@example.com", "pro")
    claims = tokens.decode_token(session.token)
    assert (claims["sub"], claims["email"], claims["tier"]) == ("user-1", "ada@example.com", "pro")
    assert (claims["iss"], claims["aud"]) == (tokens.ISSUER, tokens.AUDIENCE)
    assert claims["exp"] - claims["iat"] == 12 * 60 * 60
    assert session.expires_at == datetime.fromtimestamp(claims["exp"], timezone.utc)

    header, payload, signature = session.token.split(".")
    forged_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
    unsigned = jwt.encode({**claims, "sub": "admin"}, key=None, algorithm="none")
    wrong_audience = jwt.encode({**claims, "aud": "other"}, tokens.signing_key(), algorithm="HS256")
    wrong_key = jwt.encode(claims, "another-key-" + "x" * 40, algorithm="HS256")
    for bad in [f"{header}.{payload}.{forged_signature}", unsigned, wrong_audience, wrong_key, "garbage"]:
        with pytest.raises(jwt.InvalidTokenError):
            tokens.decode_token(bad)

    expired = tokens.issue_token("user-1", "ada@example.com", "pro", now=datetime.now(timezone.utc) - timedelta(days=1))
    with pytest.raises(jwt.ExpiredSignatureError):
        tokens.decode_token(expired.token)


def test_a_generated_signing_key_is_kept_and_reused(tmp_path: Path) -> None:
    key_file = tmp_path / "nested" / tokens.SECRET_FILE_NAME
    first = tokens._load_or_create_secret(key_file)
    assert len(first) >= tokens.MIN_SECRET_CHARS
    assert key_file.read_text(encoding="utf-8") == first
    assert tokens._load_or_create_secret(key_file) == first


def test_default_locations_are_inside_backend_data(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WEB_AUTH_DATABASE_URL", raising=False)
    defaults = Settings(_env_file=None)
    expected = database.BACKEND_DIR / "data" / "web_users.db"
    assert Path(database.resolve_database_url(defaults.WEB_AUTH_DATABASE_URL).database) == expected
    monkeypatch.setattr(tokens, "get_settings", lambda: defaults)
    assert tokens.secret_file() == expected.with_name(tokens.SECRET_FILE_NAME)


def test_a_short_configured_secret_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tokens, "get_settings", lambda: Settings(_env_file=None, AUTH_JWT_SECRET="too-short"))
    tokens.signing_key.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="at least 32"):
            tokens.signing_key()
    finally:
        tokens.signing_key.cache_clear()


def test_account_tables_live_in_their_own_database() -> None:
    assert set(inspect(web_engine).get_table_names()) == {"users", "license_keys", "subscriptions", "device_sessions"}
    assert {"license_keys", "subscriptions"}.isdisjoint(inspect(database.engine).get_table_names())


# ---------------------------------------------------------------------------
# POST /api/auth/signup
# ---------------------------------------------------------------------------
def test_signup_creates_an_account_with_a_free_license(client: "TestClient") -> None:
    response = signup(client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == {"token", "tokenType", "expiresAt", "user", "license", "entitlements"}
    assert body["entitlements"]["tier"] == "free" and body["entitlements"]["triggerLimit"] == 1
    assert "fluency" not in body["entitlements"]["features"]
    assert body["tokenType"] == "bearer"
    user, license_ = body["user"], body["license"]
    assert (user["email"], user["planTier"], user["isActive"]) == ("ada@example.com", "free", True)
    assert KEY_PATTERN.fullmatch(license_["key"])
    assert license_ == {"key": license_["key"], "tier": "free", "status": "active", "hardwareBound": False, "activatedAt": None}
    assert tokens.decode_token(body["token"])["sub"] == user["id"]

    with Session(web_engine) as session:
        stored = session.get(WebUser, user["id"])
        assert stored.passwordHash.startswith("$argon2id$v=19$m=65536,t=3,p=4$")
        assert PASSWORD not in stored.passwordHash
        assert stored.licenseKey == license_["key"]
        key = session.scalars(select(LicenseKey)).one()
        assert (key.keyString, key.userId, key.tier, key.hardwareIdBound, key.activatedAt) == (
            license_["key"], user["id"], "free", None, None,
        )


def test_an_email_can_sign_up_only_once(client: "TestClient") -> None:
    assert signup(client).status_code == 201
    duplicate = signup(client, email="ADA@example.COM", password="a different password")
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "An account with this email already exists."


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-email", "password": PASSWORD},
        {"email": "ada@example.com", "password": "short77"},
        {"email": "ada@example.com", "password": "x" * 257},
        {"email": "ada@example.com"},
        {"password": PASSWORD},
    ],
)
def test_signup_validates_its_input(client: "TestClient", body: dict) -> None:
    assert client.post("/api/auth/signup", json=body).status_code == 422


# ---------------------------------------------------------------------------
# POST /api/auth/login and GET /api/auth/me
# ---------------------------------------------------------------------------
def test_login_returns_a_session_and_the_license_status(client: "TestClient") -> None:
    user, key_string = make_user(tier="pro")
    response = login(client, email="  ADA@example.com ")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["id"] == user.id
    assert body["license"] == {"key": key_string, "tier": "pro", "status": "active", "hardwareBound": False, "activatedAt": None}
    assert tokens.decode_token(body["token"])["tier"] == "pro"


def test_wrong_passwords_and_unknown_emails_get_the_same_answer(client: "TestClient") -> None:
    make_user()
    wrong = login(client, password="wrong password")
    unknown = login(client, email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email or password."}
    assert wrong.headers["www-authenticate"] == unknown.headers["www-authenticate"] == "Bearer"


def test_a_disabled_account_is_only_revealed_to_its_password(client: "TestClient") -> None:
    make_user(active=False)
    assert login(client, password="wrong password").status_code == 401
    disabled = login(client)
    assert disabled.status_code == 403
    assert disabled.json()["detail"] == "This account is disabled."


def test_repeated_failures_are_throttled(client: "TestClient", monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "login_throttle", LoginThrottle(max_failures=2, window_seconds=60))
    make_user()
    assert login(client).status_code == 200
    assert login(client, password="wrong 1").status_code == 401
    assert login(client, password="wrong 2").status_code == 401
    blocked = login(client)
    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["retry-after"]) <= 60
    # Other addresses are unaffected.
    assert login(client, email="other@example.com").status_code == 401


def test_old_hashes_are_upgraded_on_login(client: "TestClient") -> None:
    weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
    user, _ = make_user(password_hash=weak.hash(PASSWORD))
    assert login(client).status_code == 200
    with Session(web_engine) as session:
        upgraded = session.get(WebUser, user.id).passwordHash
    assert upgraded.startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    assert passwords.verify_password(PASSWORD, upgraded)


def test_me_needs_a_valid_session(client: "TestClient") -> None:
    user, key_string = make_user()
    token = login(client).json()["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["id"] == user.id
    assert me.json()["license"]["key"] == key_string

    expired = tokens.issue_token(user.id, user.email, "free", now=datetime.now(timezone.utc) - timedelta(days=2)).token
    for headers in [{}, {"Authorization": "Bearer nonsense"}, {"Authorization": f"Bearer {expired}"}, {"Authorization": token}]:
        response = client.get("/api/auth/me", headers=headers)
        assert response.status_code == 401, headers
        assert response.headers["www-authenticate"] == "Bearer"

    with Session(web_engine) as session, session.begin():
        session.get(WebUser, user.id).isActive = False
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


# ---------------------------------------------------------------------------
# POST /api/license/verify
# ---------------------------------------------------------------------------
def test_first_verification_binds_the_key_to_the_machine(client: "TestClient") -> None:
    _, key_string = make_user(tier="lifetime")
    first = verify(client, "ada@example.com", key_string)
    assert (first["valid"], first["status"], first["tier"], first["hardwareBound"]) == (True, "active", "lifetime", True)
    activated = datetime.fromisoformat(first["activatedAt"])
    assert activated.utcoffset() == timedelta(0)

    again = verify(client, "ADA@example.com", f" {key_string.lower()} ")
    assert (again["valid"], again["status"], again["activatedAt"]) == (True, "active", first["activatedAt"])

    for other in ["another-machine-guid", None]:
        mismatch = verify(client, "ada@example.com", key_string, hardware=other)
        assert (mismatch["valid"], mismatch["status"], mismatch["hardwareBound"]) == (False, "hardware_mismatch", True)

    with Session(web_engine) as session:
        bound = session.scalars(select(LicenseKey)).one().hardwareIdBound
    assert bound == licenses.hardware_fingerprint(HARDWARE)


def test_verification_without_a_machine_id_does_not_bind(client: "TestClient") -> None:
    _, key_string = make_user()
    result = verify(client, "ada@example.com", key_string, hardware=None)
    assert (result["valid"], result["hardwareBound"], result["activatedAt"]) == (True, False, None)
    assert verify(client, "ada@example.com", key_string)["hardwareBound"] is True


def test_invalid_combinations_all_look_the_same(client: "TestClient") -> None:
    _, ada_key = make_user()
    _, bob_key = make_user("bob@example.com")
    answers = [
        verify(client, "nobody@example.com", ada_key),
        verify(client, "ada@example.com", bob_key),
        verify(client, "ada@example.com", licenses.generate_license_key()),
        verify(client, "ada@example.com", "not a key"),
    ]
    for answer in answers:
        assert answer.pop("checkedAt")
        assert answer == {
            "valid": False, "status": "invalid", "tier": None, "hardwareBound": False, "activatedAt": None,
            "features": [], "triggerLimit": None, "expiresAt": None,
        }
    # None of those attempts bound anything.
    assert verify(client, "bob@example.com", bob_key, hardware=None)["hardwareBound"] is False


def test_disabled_accounts_and_replaced_keys_are_inactive(client: "TestClient") -> None:
    _, disabled_key = make_user("off@example.com", active=False)
    user, old_key = make_user()
    replacement = licenses.generate_license_key()
    with Session(web_engine) as session, session.begin():
        stored = session.get(WebUser, user.id)
        session.add(LicenseKey(keyString=replacement, userId=stored.id, tier="pro"))
        session.flush()
        stored.licenseKey = replacement
        stored.planTier = "pro"

    for email, key in [("off@example.com", disabled_key), ("ada@example.com", old_key)]:
        result = verify(client, email, key)
        assert (result["valid"], result["status"], result["hardwareBound"]) == (False, "inactive", False)
    current = verify(client, "ada@example.com", replacement)
    assert (current["valid"], current["tier"]) == (True, "pro")
    assert "fluency" in current["features"] and current["triggerLimit"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"email": "ada@example.com", "licenseKey": "VM-AAAA-BBBB-CCCC", "hardwareId": "short"},
        {"email": "ada@example.com", "licenseKey": ""},
        {"email": "nope", "licenseKey": "VM-AAAA-BBBB-CCCC"},
    ],
)
def test_verify_validates_its_input(client: "TestClient", body: dict) -> None:
    assert client.post("/api/license/verify", json=body).status_code == 422


# ---------------------------------------------------------------------------
# Throttle
# ---------------------------------------------------------------------------
def test_throttle_forgets_old_failures_and_bounds_its_memory() -> None:
    now = [0.0]
    throttle = LoginThrottle(max_failures=2, window_seconds=10, max_tracked=2, clock=lambda: now[0])
    throttle.record_failure("a")
    now[0] = 4
    throttle.record_failure("a")
    assert throttle.retry_after("a") == 6
    now[0] = 10.5
    assert throttle.retry_after("a") == 0
    throttle.record_failure("a")
    throttle.record_failure("b")
    throttle.record_failure("c")
    assert "a" not in throttle._failures
    throttle.reset("b")
    assert list(throttle._failures) == ["c"]
