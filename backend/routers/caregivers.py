"""Caregiver allowances: which accounts may watch a speaker over the caregiver link.

- GET    /api/caregivers                  signed in: my caregivers (and their requests), and the speakers I watch
- POST   /api/caregivers                  signed in, caregiver_link: approve an account by username
- POST   /api/caregivers/{id}/decision    signed in, the speaker: approve or deny a request
- DELETE /api/caregivers/{id}             signed in, either side: end the allowance

A change applies to live connections at once: an approved caregiver waiting in the speaker's room is let in, and a
denied or removed one is disconnected (routers/signalling.py).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.concurrency import run_in_threadpool

from routers import signalling
from routers.auth import WebDb, signed_in_user
from schemas import CaregiverAccessList, CaregiverAddRequest, CaregiverAllowanceOut, CaregiverDecisionRequest
from web_auth import allowances
from web_auth.models import CaregiverAllowance, WebUser
from web_auth.plans import FEATURE_NAMES, features_for, settle_plan
from web_auth.profiles import find_by_username

router = APIRouter(prefix="/api/caregivers", tags=["web-caregivers"])

SignedIn = Annotated[WebUser, Depends(signed_in_user)]


def require_caregiver_link(db, user: WebUser) -> None:
    tier, _ = settle_plan(db, user)
    if "caregiver_link" not in features_for(tier):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{FEATURE_NAMES['caregiver_link']} is part of Voicematics Pro. Upgrade your plan to let caregivers watch you.",
        )


@router.get("", response_model=CaregiverAccessList)
def list_allowances(user: SignedIn, db: WebDb) -> CaregiverAccessList:
    caregivers, speakers = allowances.list_for(db, user.id)
    return CaregiverAccessList(caregivers=caregivers, speakers=speakers)


@router.post("", response_model=CaregiverAllowanceOut, status_code=status.HTTP_201_CREATED)
async def add_caregiver(payload: CaregiverAddRequest, user: SignedIn, db: WebDb) -> CaregiverAllowanceOut:
    def approve() -> tuple[CaregiverAllowanceOut, str]:
        require_caregiver_link(db, user)
        found = find_by_username(db, payload.username)
        if found is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No Voicematics account has that username.")
        caregiver, _ = found
        if caregiver.id == user.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That is your own username.")
        row = allowances.approve_account(db, user.id, caregiver.id)
        return allowances.allowance_out(db, row, user.id), caregiver.id

    out, caregiver_id = await run_in_threadpool(approve)
    await signalling.allowance_changed(user.id, caregiver_id, "approved")
    return out


@router.post("/{allowance_id}/decision", response_model=CaregiverAllowanceOut)
async def decide(allowance_id: str, payload: CaregiverDecisionRequest, user: SignedIn, db: WebDb) -> CaregiverAllowanceOut:
    def apply() -> tuple[CaregiverAllowanceOut, str, str]:
        if payload.approve:
            require_caregiver_link(db, user)
        row = allowances.decide(db, user.id, allowance_id, payload.approve)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="There is no such request.")
        return allowances.allowance_out(db, row, user.id), row.caregiverId, row.status

    out, caregiver_id, new_status = await run_in_threadpool(apply)
    await signalling.allowance_changed(user.id, caregiver_id, new_status)
    return out


@router.delete("/{allowance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(allowance_id: str, user: SignedIn, db: WebDb) -> Response:
    def delete() -> tuple[str, str]:
        row = db.get(CaregiverAllowance, allowance_id)
        if row is None or user.id not in (row.speakerId, row.caregiverId):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="There is no such caregiver.")
        pair = (row.speakerId, row.caregiverId)
        db.delete(row)
        db.commit()
        return pair

    speaker_id, caregiver_id = await run_in_threadpool(delete)
    await signalling.allowance_changed(speaker_id, caregiver_id, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
