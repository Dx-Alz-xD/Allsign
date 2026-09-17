"""Usernames, display names and the sign-up interview answers (the `profiles` table).

Every account has a username: the name a speaker approves when someone asks to watch them as a caregiver. An
account created without choosing one (the desktop app's sign-up, accounts older than profiles) gets one built from
its email address the first time it is read.
"""

import json
import re
import secrets
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import utcnow
from schemas import USERNAME_PATTERN, OnboardingAnswers, ProfileOut
from web_auth.models import Profile, WebUser

# Names that would read as the service speaking.
RESERVED_USERNAMES = frozenset(
    {"admin", "administrator", "root", "system", "support", "help", "voicematics", "staff", "moderator", "caregiver", "speaker", "api", "about", "null", "undefined"}
)
GENERATE_ATTEMPTS = 8


class UsernameTaken(Exception):
    pass


def username_problem(username: str) -> str | None:
    """Why a (lower-case) username cannot be used, or None."""
    if not re.fullmatch(USERNAME_PATTERN, username):
        return "Use 3 to 20 letters, digits, dots or underscores, starting and ending with a letter or digit."
    if username in RESERVED_USERNAMES:
        return "That username is reserved."
    return None


def username_in_use(db: Session, username: str, *, except_user: str | None = None) -> bool:
    query = select(Profile.userId).where(func.lower(Profile.username) == username.lower())
    if except_user is not None:
        query = query.where(Profile.userId != except_user)
    return db.scalar(query) is not None


def _base_from_email(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9]+", "", local)[:14]
    return base if len(base) >= 3 else f"user{base}"


def _generated_username(db: Session, email: str) -> str:
    base = _base_from_email(email)
    if username_problem(base) is None and not username_in_use(db, base):
        return base
    for _ in range(GENERATE_ATTEMPTS):
        candidate = f"{base}{secrets.randbelow(10_000):04d}"
        if username_problem(candidate) is None and not username_in_use(db, candidate):
            return candidate
    return f"user{secrets.token_hex(6)}"


def load_profile(db: Session, user: WebUser) -> Profile:
    """The account's profile, created with a generated username when it has none yet."""
    profile = db.get(Profile, user.id)
    if profile is not None:
        return profile
    for _ in range(GENERATE_ATTEMPTS):
        profile = Profile(userId=user.id, username=_generated_username(db, user.email), displayName="")
        db.add(profile)
        try:
            db.commit()
            return profile
        except IntegrityError:
            db.rollback()
            existing = db.get(Profile, user.id)
            if existing is not None:  # created concurrently by another request
                return existing
    raise RuntimeError("Could not allocate a username.")


def create_profile(db: Session, user: WebUser, username: str | None, display_name: str | None, onboarding: OnboardingAnswers | None) -> None:
    """Adds the profile for a new account to the session (committed with the account). Raises UsernameTaken."""
    if username is not None and username_in_use(db, username):
        raise UsernameTaken
    now = utcnow()
    db.add(
        Profile(
            user=user,
            username=username or _generated_username(db, user.email),
            displayName=display_name or "",
            onboarding=_encode_onboarding(onboarding, now),
            createdAt=now,
            updatedAt=now,
        )
    )


def _encode_onboarding(answers: OnboardingAnswers | None, completed_at: datetime) -> str | None:
    if answers is None:
        return None
    payload = answers.model_dump(mode="json")
    payload["completedAt"] = completed_at.isoformat()
    return json.dumps(payload)


def _decode_onboarding(raw: str | None) -> tuple[OnboardingAnswers | None, datetime | None]:
    if not raw:
        return None, None
    try:
        data = json.loads(raw)
        completed = data.pop("completedAt", None)
        return OnboardingAnswers.model_validate(data), datetime.fromisoformat(completed) if completed else None
    except (ValueError, TypeError, ValidationError):
        # Answers saved by an older version that no longer validate are dropped, not an error.
        return None, None


def update_profile(db: Session, profile: Profile, *, username: str | None, display_name: str | None, onboarding: OnboardingAnswers | None) -> Profile:
    """Raises UsernameTaken."""
    now = utcnow()
    if username is not None and username != profile.username:
        if username_in_use(db, username, except_user=profile.userId):
            raise UsernameTaken
        profile.username = username
    if display_name is not None:
        profile.displayName = display_name
    if onboarding is not None:
        profile.onboarding = _encode_onboarding(onboarding, now)
    profile.updatedAt = now
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise UsernameTaken from None
    return profile


def profile_out(profile: Profile) -> ProfileOut:
    answers, completed = _decode_onboarding(profile.onboarding)
    return ProfileOut(
        username=profile.username,
        displayName=profile.displayName,
        onboarding=answers,
        onboardingCompletedAt=completed,
        updatedAt=profile.updatedAt,
    )


def find_by_username(db: Session, username: str) -> tuple[WebUser, Profile] | None:
    row = db.execute(
        select(WebUser, Profile).join(Profile, Profile.userId == WebUser.id).where(func.lower(Profile.username) == username.strip().lower())
    ).first()
    return (row[0], row[1]) if row else None
