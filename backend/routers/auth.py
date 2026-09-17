"""Voicematics website accounts and desktop licences, stored in data/web_users.db.

- POST /api/auth/signup   create an account with a free licence key (and optionally a username and the sign-up
                          interview answers), returns a session token
- POST /api/auth/login    check the password, returns a session token and the licence status
- GET  /api/auth/me       the signed-in account (Authorization: Bearer <token>)
- POST /api/auth/me/delete  signed in + password: erase the account and everything saved with it
- POST /api/auth/devices          signed in: remember this computer, returns a device token once
- POST /api/auth/devices/session  device token + hardware id -> a fresh session token
- POST /api/auth/devices/revoke   sign this computer out (the device token proves possession)
- POST /api/license/verify  the desktop app's startup check of email + licence key, bound to one machine
- POST /api/license/deactivate  signed in: unbind the key from its machine so another one can activate it

Every answer carries the account's entitlements (web_auth/plans.py): the tier it is really on once lapsed
subscriptions are settled, the features that tier unlocks and when it ends.

Login answers the same way for an unknown email and a wrong password, and spends the same Argon2 work on
both. Licence verification answers "invalid" the same way for an unknown email, an unknown key and another
account's key.
"""

import hashlib
import hmac
import secrets
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import User, new_id, utcnow
from schemas import (
    AccountDeleteRequest,
    AccountResponse,
    AuthSessionResponse,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceRevokeRequest,
    DeviceSessionRequest,
    Entitlements,
    LicenseDeactivateResponse,
    LicenseInfo,
    LicenseVerifyRequest,
    LicenseVerifyResponse,
    LoginRequest,
    SignupRequest,
    WebUserOut,
)
from web_auth.database import get_web_db
from web_auth.licenses import generate_license_key, hardware_fingerprint, normalise_license_key
from web_auth.models import DeviceSession, LicenseKey, WebUser
from web_auth.passwords import hash_password, needs_rehash, spend_verification, verify_password
from web_auth.plans import features_for, plan_expires_at, settle_plan, trigger_limit_for
from web_auth.profiles import UsernameTaken, create_profile, load_profile, profile_out, username_in_use, username_problem
from web_auth.throttle import LoginThrottle
from web_auth.tokens import decode_token, issue_token

router = APIRouter(prefix="/api/auth", tags=["web-auth"])
license_router = APIRouter(prefix="/api/license", tags=["web-licenses"])

WebDb = Annotated[Session, Depends(get_web_db)]
bearer_scheme = HTTPBearer(auto_error=False)
login_throttle = LoginThrottle()

SIGNUP_KEY_ATTEMPTS = 5
INVALID_CREDENTIALS = "Invalid email or password."
DEVICE_SIGNED_OUT = "This computer is signed out. Sign in again."
# Remembered computers per account; registering one more revokes the least recently used.
MAX_DEVICES = 10


def normalise_email(email: str) -> str:
    return email.strip().lower()


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def current_license(db: Session, user: WebUser) -> LicenseKey | None:
    if user.licenseKey is None:
        return None
    return db.scalar(select(LicenseKey).where(LicenseKey.keyString == user.licenseKey, LicenseKey.userId == user.id))


def license_info(user: WebUser, key: LicenseKey | None) -> LicenseInfo | None:
    if key is None:
        return None
    return LicenseInfo(
        key=key.keyString,
        tier=key.tier,
        status="active" if user.isActive else "inactive",
        hardwareBound=key.hardwareIdBound is not None,
        activatedAt=key.activatedAt,
    )


def entitlements(db: Session, user: WebUser) -> Entitlements:
    tier, subscription = settle_plan(db, user)
    return Entitlements(
        tier=tier, features=features_for(tier), triggerLimit=trigger_limit_for(tier), expiresAt=plan_expires_at(subscription)
    )


def session_response(db: Session, user: WebUser, key: LicenseKey | None) -> AuthSessionResponse:
    granted = entitlements(db, user)
    session = issue_token(user.id, user.email, granted.tier)
    return AuthSessionResponse(
        token=session.token,
        expiresAt=session.expires_at,
        user=WebUserOut.model_validate(user),
        license=license_info(user, key),
        entitlements=granted,
        profile=profile_out(load_profile(db, user)),
    )


def email_taken(db: Session, email: str) -> bool:
    return db.scalar(select(WebUser.id).where(WebUser.email == email)) is not None


@router.post("/signup", response_model=AuthSessionResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: WebDb) -> AuthSessionResponse:
    email = normalise_email(payload.email)
    conflict = HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")
    username_conflict = HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is taken. Choose another one.")
    if email_taken(db, email):
        raise conflict
    if payload.username is not None:
        problem = username_problem(payload.username)
        if problem:
            raise HTTPException(status_code=422, detail=problem)
        if username_in_use(db, payload.username):
            raise username_conflict
    password_hash = hash_password(payload.password)

    for _ in range(SIGNUP_KEY_ATTEMPTS):
        key_string = generate_license_key()
        user = WebUser(id=new_id(), email=email, passwordHash=password_hash, planTier="free", licenseKey=key_string, isActive=True)
        key = LicenseKey(keyString=key_string, user=user, tier="free")
        db.add_all([user, key])
        try:
            create_profile(db, user, payload.username, payload.displayName, payload.onboarding)
            db.commit()
        except UsernameTaken:
            db.rollback()
            raise username_conflict from None
        except IntegrityError:
            db.rollback()
            # A concurrent signup took the email or the username, or (at 2^-60 odds) the key already exists.
            if email_taken(db, email):
                raise conflict from None
            if payload.username is not None and username_in_use(db, payload.username):
                raise username_conflict from None
            continue
        return session_response(db, user, key)
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not allocate a license key.")


@router.post("/login", response_model=AuthSessionResponse)
def login(payload: LoginRequest, db: WebDb) -> AuthSessionResponse:
    email = normalise_email(payload.email)
    wait = login_throttle.retry_after(email)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Try again later.",
            headers={"Retry-After": str(wait)},
        )

    user = db.scalar(select(WebUser).where(WebUser.email == email))
    if user is None:
        spend_verification(payload.password)
        login_throttle.record_failure(email)
        raise unauthorized(INVALID_CREDENTIALS)
    if not verify_password(payload.password, user.passwordHash):
        login_throttle.record_failure(email)
        raise unauthorized(INVALID_CREDENTIALS)
    # Only someone who knows the password learns that the account is disabled.
    if not user.isActive:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is disabled.")

    login_throttle.reset(email)
    if needs_rehash(user.passwordHash):
        user.passwordHash = hash_password(payload.password)
        db.commit()
    return session_response(db, user, current_license(db, user))


def signed_in_user(
    db: WebDb, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]
) -> WebUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized("Sign in first.")
    try:
        claims = decode_token(credentials.credentials)
    except jwt.InvalidTokenError:
        raise unauthorized("Your session is invalid or has expired. Sign in again.") from None
    user = db.get(WebUser, claims["sub"])
    if user is None or not user.isActive:
        raise unauthorized("Your session is invalid or has expired. Sign in again.")
    return user


@router.get("/me", response_model=AccountResponse)
def me(user: Annotated[WebUser, Depends(signed_in_user)], db: WebDb) -> AccountResponse:
    granted = entitlements(db, user)  # first: settling a lapsed plan may change the user's tier
    return AccountResponse(
        user=WebUserOut.model_validate(user),
        license=license_info(user, current_license(db, user)),
        entitlements=granted,
        profile=profile_out(load_profile(db, user)),
    )


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    payload: AccountDeleteRequest,
    user: Annotated[WebUser, Depends(signed_in_user)],
    db: WebDb,
    app_db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Erases the account, its licences, subscriptions and remembered computers, and every trigger, preset, session
    and phoneme target saved under it. A wrong password answers 403, not 401, because the session itself is fine."""
    wait = login_throttle.retry_after(user.email)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Try again later.",
            headers={"Retry-After": str(wait)},
        )
    if not verify_password(payload.password, user.passwordHash):
        login_throttle.record_failure(user.email)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That password is not correct.")
    login_throttle.reset(user.email)
    # App data first: if this fails the account still exists and the request can be repeated.
    app_db.execute(delete(User).where(User.id == user.id))  # owned rows go with it (ON DELETE CASCADE)
    app_db.commit()
    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def device_secret_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def live_device(db: Session, token: str) -> DeviceSession | None:
    return db.scalar(select(DeviceSession).where(DeviceSession.secretHash == device_secret_hash(token), DeviceSession.revokedAt.is_(None)))


@router.post("/devices", response_model=DeviceRegisterResponse, status_code=status.HTTP_201_CREATED)
def register_device(payload: DeviceRegisterRequest, user: Annotated[WebUser, Depends(signed_in_user)], db: WebDb) -> DeviceRegisterResponse:
    now = utcnow()
    active = list(
        db.scalars(
            select(DeviceSession)
            .where(DeviceSession.userId == user.id, DeviceSession.revokedAt.is_(None))
            .order_by(DeviceSession.lastUsedAt.desc())
        )
    )
    for stale in active[MAX_DEVICES - 1 :]:
        stale.revokedAt = now
    token = secrets.token_urlsafe(32)
    device = DeviceSession(
        userId=user.id,
        secretHash=device_secret_hash(token),
        hardwareFingerprint=hardware_fingerprint(payload.hardwareId),
        label=payload.label,
        createdAt=now,
        lastUsedAt=now,
    )
    db.add(device)
    db.commit()
    return DeviceRegisterResponse(deviceId=device.id, deviceToken=token)


@router.post("/devices/session", response_model=AuthSessionResponse)
def device_session(payload: DeviceSessionRequest, db: WebDb) -> AuthSessionResponse:
    """Every failure answers the same 401: unknown or revoked token, another machine, a disabled account."""
    device = live_device(db, payload.deviceToken)
    user = db.get(WebUser, device.userId) if device is not None else None
    if (
        device is None
        or user is None
        or not user.isActive
        or not hmac.compare_digest(device.hardwareFingerprint, hardware_fingerprint(payload.hardwareId))
    ):
        raise unauthorized(DEVICE_SIGNED_OUT)
    device.lastUsedAt = utcnow()
    db.commit()
    return session_response(db, user, current_license(db, user))


@router.post("/devices/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_device(payload: DeviceRevokeRequest, db: WebDb) -> Response:
    """Idempotent, and silent about whether the token existed."""
    device = live_device(db, payload.deviceToken)
    if device is not None:
        device.revokedAt = utcnow()
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@license_router.post("/deactivate", response_model=LicenseDeactivateResponse)
def deactivate_license(user: Annotated[WebUser, Depends(signed_in_user)], db: WebDb) -> LicenseDeactivateResponse:
    """Unbinds the account's current key from its machine. The next verification with a hardware id binds it again."""
    key = current_license(db, user)
    if key is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This account has no license key.")
    if key.hardwareIdBound is None:
        return LicenseDeactivateResponse(key=key.keyString, hardwareBound=False, message="The key is not bound to any machine.")
    key.hardwareIdBound = None
    key.activatedAt = None
    db.commit()
    return LicenseDeactivateResponse(key=key.keyString, hardwareBound=False, message="The key can now be activated on another machine.")


@license_router.post("/verify", response_model=LicenseVerifyResponse)
def verify_license(payload: LicenseVerifyRequest, db: WebDb) -> LicenseVerifyResponse:
    now = utcnow()
    key_string = normalise_license_key(payload.licenseKey)
    row = None
    if key_string is not None:
        row = db.execute(
            select(LicenseKey, WebUser)
            .join(WebUser, LicenseKey.userId == WebUser.id)
            .where(LicenseKey.keyString == key_string, WebUser.email == normalise_email(payload.email))
        ).first()
    if row is None:
        return LicenseVerifyResponse(valid=False, status="invalid", checkedAt=now)

    key, user = row
    tier, subscription = settle_plan(db, user, now)
    details = {"tier": tier, "checkedAt": now}
    if not user.isActive or user.licenseKey != key.keyString:
        return LicenseVerifyResponse(
            valid=False, status="inactive", hardwareBound=key.hardwareIdBound is not None, activatedAt=key.activatedAt, **details
        )

    fingerprint = hardware_fingerprint(payload.hardwareId) if payload.hardwareId else ""
    if key.hardwareIdBound is None and fingerprint:
        # Conditional, so two machines activating at once cannot both claim the key.
        db.execute(
            update(LicenseKey)
            .where(LicenseKey.id == key.id, LicenseKey.hardwareIdBound.is_(None))
            .values(hardwareIdBound=fingerprint, activatedAt=now)
        )
        db.commit()
        db.refresh(key)
    # A bound key only validates on its machine, so leaving the id out does not get around the binding.
    if key.hardwareIdBound is not None and not hmac.compare_digest(key.hardwareIdBound, fingerprint):
        return LicenseVerifyResponse(
            valid=False, status="hardware_mismatch", hardwareBound=True, activatedAt=key.activatedAt, **details
        )

    return LicenseVerifyResponse(
        valid=True,
        status="active",
        hardwareBound=key.hardwareIdBound is not None,
        activatedAt=key.activatedAt,
        features=features_for(tier),
        triggerLimit=trigger_limit_for(tier),
        expiresAt=plan_expires_at(subscription),
        **details,
    )
