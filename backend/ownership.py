"""Which account a request acts for.

The desktop app and the website send `Authorization: Bearer <session token>` once someone is signed in.
Rows written then belong to that account, and only that account sees them. Without a token the API is in
local mode: rows with no owner, the way a single-user install worked before accounts existed. Both modes
share the same tables, so one backend serves a laptop demo and the hosted service alike.

Accounts live in web_users.db; the app tables reference the `users` table in the app database, so the
first authenticated request mirrors the account there (id and email only).
"""

from typing import Annotated, TypeVar

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Select
from sqlalchemy.orm import Session

from database import get_db
from models import User
from web_auth.database import SessionLocal as WebSessionLocal
from web_auth.models import WebUser
from web_auth.tokens import decode_token

bearer_scheme = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db)]
T = TypeVar("T")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def current_owner(db: DbSession, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]) -> str | None:
    """The signed-in account's id, or None in local mode. A token that is present but bad is a 401."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    try:
        claims = decode_token(credentials.credentials)
    except jwt.InvalidTokenError:
        raise _unauthorized("Your session is invalid or has expired. Sign in again.") from None
    user_id = str(claims["sub"])
    with WebSessionLocal() as web:
        account = web.get(WebUser, user_id)
        if account is None or not account.isActive:
            raise _unauthorized("Your session is invalid or has expired. Sign in again.")
        email = account.email
    if db.get(User, user_id) is None:
        db.add(User(id=user_id, displayName=email[:100]))
        db.commit()
    return user_id


Owner = Annotated[str | None, Depends(current_owner)]


def owned(query: Select[T], model, owner: str | None) -> Select[T]:
    """Restricts a select to the caller's rows: the account's, or the unowned local rows."""
    return query.where(model.userId == owner) if owner is not None else query.where(model.userId.is_(None))


def get_owned_or_404(db: Session, model, row_id: str, owner: str | None, label: str):
    row = db.get(model, row_id)
    if row is None or row.userId != owner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} '{row_id}' not found")
    return row
