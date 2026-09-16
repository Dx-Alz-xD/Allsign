"""Which account a request acts for, and what its plan allows.

The desktop app and the website send `Authorization: Bearer <session token>` once someone is signed in.
Rows written then belong to that account, and only that account sees them.

REQUIRE_ACCOUNT (on by default) makes this a hosted service: the app-data endpoints answer 401 without a
session, and features outside the account's plan answer 403. With it off, a request without a token runs
in local mode instead: rows with no owner and every feature, the way a single-user install on your own
machine worked before accounts existed. A token that is present is always checked, in both modes.

Accounts live in web_users.db; the app tables reference the `users` table in the app database, so the
first authenticated request mirrors the account there (id and email only).
"""

from dataclasses import dataclass
from typing import Annotated, TypeVar

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Select
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models import User
from web_auth.database import SessionLocal as WebSessionLocal
from web_auth.models import WebUser
from web_auth.plans import FEATURE_NAMES, Feature, features_for, settle_plan, trigger_limit_for
from web_auth.tokens import decode_token

bearer_scheme = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db)]
T = TypeVar("T")

SESSION_INVALID = "Your session is invalid or has expired. Sign in again."
SIGN_IN_REQUIRED = "Sign in to your Voicematics account to use this."


@dataclass(frozen=True)
class Account:
    """The caller: a signed-in account with its plan, or local mode (id None, everything allowed)."""

    id: str | None
    email: str | None = None
    tier: str | None = None
    features: frozenset[str] = frozenset()
    trigger_limit: int | None = None

    def has(self, feature: Feature) -> bool:
        return self.id is None or feature in self.features


LOCAL = Account(id=None)


class AccountError(Exception):
    """Why a caller cannot act as an account; `detail` is safe to show."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def resolve_account(token: str | None) -> Account:
    """The account behind a session token, with its plan settled; LOCAL when there is no token and accounts
    are optional. Raises AccountError otherwise. Shared by the HTTP routes and the signalling relay."""
    if not token:
        if get_settings().REQUIRE_ACCOUNT:
            raise AccountError(SIGN_IN_REQUIRED)
        return LOCAL
    try:
        claims = decode_token(token)
    except jwt.InvalidTokenError:
        raise AccountError(SESSION_INVALID) from None
    with WebSessionLocal() as web:
        user = web.get(WebUser, str(claims["sub"]))
        if user is None or not user.isActive:
            raise AccountError(SESSION_INVALID)
        # Settled on every request, so an upgrade, a cancellation running out or a lapsed renewal applies at once.
        tier, _ = settle_plan(web, user)
        return Account(
            id=user.id,
            email=user.email,
            tier=tier,
            features=frozenset(features_for(tier)),
            trigger_limit=trigger_limit_for(tier),
        )


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def current_account(db: DbSession, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]) -> Account:
    token = credentials.credentials if credentials is not None and credentials.scheme.lower() == "bearer" else None
    try:
        account = resolve_account(token)
    except AccountError as error:
        raise _unauthorized(error.detail) from None
    if account.id is not None and db.get(User, account.id) is None:
        db.add(User(id=account.id, displayName=(account.email or "")[:100]))
        db.commit()
    return account


CurrentAccount = Annotated[Account, Depends(current_account)]


def current_owner(account: CurrentAccount) -> str | None:
    """The signed-in account's id, or None in local mode."""
    return account.id


Owner = Annotated[str | None, Depends(current_owner)]


def plan_required(feature: Feature) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"{FEATURE_NAMES[feature]} is part of Voicematics Pro. Upgrade your plan to use it.",
    )


def require_feature(feature: Feature):
    """A route dependency: 401 without a session (when accounts are required), 403 when the plan lacks the feature."""

    def check(account: CurrentAccount) -> Account:
        if not account.has(feature):
            raise plan_required(feature)
        return account

    return Depends(check)


def owned(query: Select[T], model, owner: str | None) -> Select[T]:
    """Restricts a select to the caller's rows: the account's, or the unowned local rows."""
    return query.where(model.userId == owner) if owner is not None else query.where(model.userId.is_(None))


def get_owned_or_404(db: Session, model, row_id: str, owner: str | None, label: str):
    row = db.get(model, row_id)
    if row is None or row.userId != owner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} '{row_id}' not found")
    return row
