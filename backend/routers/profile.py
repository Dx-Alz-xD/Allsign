"""The account's public profile and the sign-up interview answers.

- GET   /api/profile                     signed in: username, display name, interview answers
- PATCH /api/profile                     signed in: change any of them (409 when the username is taken)
- GET   /api/profile/username?name=...   is a username free? (used while signing up, before there is an account)
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from routers.auth import WebDb, signed_in_user
from schemas import ProfileOut, ProfileUpdate, UsernameAvailability
from web_auth.models import WebUser
from web_auth.profiles import UsernameTaken, load_profile, profile_out, update_profile, username_in_use, username_problem

router = APIRouter(prefix="/api/profile", tags=["web-profile"])

SignedIn = Annotated[WebUser, Depends(signed_in_user)]
TAKEN = "That username is taken. Choose another one."


@router.get("", response_model=ProfileOut)
def get_profile(user: SignedIn, db: WebDb) -> ProfileOut:
    return profile_out(load_profile(db, user))


@router.patch("", response_model=ProfileOut)
def patch_profile(payload: ProfileUpdate, user: SignedIn, db: WebDb) -> ProfileOut:
    profile = load_profile(db, user)
    if payload.username is not None and payload.username != profile.username:
        problem = username_problem(payload.username)
        if problem:
            raise HTTPException(status_code=422, detail=problem)
    try:
        updated = update_profile(db, profile, username=payload.username, display_name=payload.displayName, onboarding=payload.onboarding)
    except UsernameTaken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=TAKEN) from None
    return profile_out(updated)


@router.get("/username", response_model=UsernameAvailability)
def username_available(db: WebDb, name: Annotated[str, Query(max_length=64)]) -> UsernameAvailability:
    candidate = name.strip().lower()
    problem = username_problem(candidate)
    if problem:
        return UsernameAvailability(username=candidate, available=False, reason=problem)
    if username_in_use(db, candidate):
        return UsernameAvailability(username=candidate, available=False, reason=TAKEN)
    return UsernameAvailability(username=candidate, available=True)
