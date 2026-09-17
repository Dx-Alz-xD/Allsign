"""Who may watch whom over the caregiver link (the `caregiver_allowances` table).

A speaker approves another account by username, or answers the request the relay raises when that account enters
the speaker's room. Only `approved` admits a caregiver; `denied` keeps it out until the speaker approves it by name.
The relay (routers/signalling.py) and the REST routes (routers/caregivers.py) both go through these functions.
"""

from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import utcnow
from schemas import AccessRequestOut, CaregiverAllowanceOut
from web_auth.database import SessionLocal
from web_auth.models import CaregiverAllowance, Profile, WebUser
from web_auth.profiles import load_profile


@dataclass(frozen=True)
class Identity:
    """What the relay needs to show a caregiver to a speaker."""

    account: str
    username: str
    display_name: str


def identity(account_id: str) -> Identity | None:
    with SessionLocal() as db:
        user = db.get(WebUser, account_id)
        if user is None:
            return None
        profile = load_profile(db, user)
        return Identity(account=user.id, username=profile.username, display_name=profile.displayName)


def status_of(speaker_id: str, caregiver_id: str) -> str | None:
    with SessionLocal() as db:
        return db.scalar(
            select(CaregiverAllowance.status).where(CaregiverAllowance.speakerId == speaker_id, CaregiverAllowance.caregiverId == caregiver_id)
        )


def request_access(speaker_id: str, caregiver_id: str) -> tuple[str, AccessRequestOut] | None:
    """The pair's status after asking, and the request to show the speaker while it is pending. A new pair starts
    as pending; an existing row keeps its status. None when either account is gone."""
    with SessionLocal() as db:
        for _ in range(2):
            row = db.scalar(select(CaregiverAllowance).where(CaregiverAllowance.speakerId == speaker_id, CaregiverAllowance.caregiverId == caregiver_id))
            if row is None:
                if db.get(WebUser, speaker_id) is None or db.get(WebUser, caregiver_id) is None:
                    return None
                row = CaregiverAllowance(speakerId=speaker_id, caregiverId=caregiver_id, status="pending")
                db.add(row)
                try:
                    db.commit()
                except IntegrityError:  # asked twice at once
                    db.rollback()
                    continue
            caregiver = db.get(WebUser, caregiver_id)
            profile = load_profile(db, caregiver)
            return row.status, AccessRequestOut(id=row.id, username=profile.username, displayName=profile.displayName, requestedAt=row.createdAt)
    return None


def pending_request(speaker_id: str, caregiver_id: str) -> AccessRequestOut | None:
    with SessionLocal() as db:
        row = db.scalar(
            select(CaregiverAllowance).where(
                CaregiverAllowance.speakerId == speaker_id, CaregiverAllowance.caregiverId == caregiver_id, CaregiverAllowance.status == "pending"
            )
        )
        if row is None:
            return None
        profile = load_profile(db, db.get(WebUser, caregiver_id))
        return AccessRequestOut(id=row.id, username=profile.username, displayName=profile.displayName, requestedAt=row.createdAt)


def decide(db: Session, speaker_id: str, allowance_id: str, approve: bool) -> CaregiverAllowance | None:
    """Approves or denies one of the speaker's allowances. None when it is not theirs."""
    row = db.get(CaregiverAllowance, allowance_id)
    if row is None or row.speakerId != speaker_id:
        return None
    row.status = "approved" if approve else "denied"
    row.decidedAt = utcnow()
    db.commit()
    return row


def decide_now(speaker_id: str, allowance_id: str, approve: bool) -> tuple[str, str] | None:
    """decide() in its own session, for the relay. Returns (caregiver id, status)."""
    with SessionLocal() as db:
        row = decide(db, speaker_id, allowance_id, approve)
        return (row.caregiverId, row.status) if row else None


def approve_account(db: Session, speaker_id: str, caregiver_id: str) -> CaregiverAllowance:
    row = db.scalar(select(CaregiverAllowance).where(CaregiverAllowance.speakerId == speaker_id, CaregiverAllowance.caregiverId == caregiver_id))
    now = utcnow()
    if row is None:
        row = CaregiverAllowance(speakerId=speaker_id, caregiverId=caregiver_id, status="approved", createdAt=now, decidedAt=now)
        db.add(row)
    else:
        row.status = "approved"
        row.decidedAt = now
    db.commit()
    return row


def _out(row: CaregiverAllowance, other: Profile) -> CaregiverAllowanceOut:
    return CaregiverAllowanceOut(
        id=row.id, username=other.username, displayName=other.displayName, status=row.status, createdAt=row.createdAt, decidedAt=row.decidedAt
    )


def allowance_out(db: Session, row: CaregiverAllowance, viewer_id: str) -> CaregiverAllowanceOut:
    other_id = row.caregiverId if row.speakerId == viewer_id else row.speakerId
    return _out(row, load_profile(db, db.get(WebUser, other_id)))


def list_for(db: Session, account_id: str) -> tuple[list[CaregiverAllowanceOut], list[CaregiverAllowanceOut]]:
    """(caregivers of this account, speakers this account watches or asked to), newest first."""
    rows = db.scalars(
        select(CaregiverAllowance)
        .where(or_(CaregiverAllowance.speakerId == account_id, CaregiverAllowance.caregiverId == account_id))
        .order_by(CaregiverAllowance.createdAt.desc())
    ).all()
    caregivers, speakers = [], []
    for row in rows:
        (caregivers if row.speakerId == account_id else speakers).append(allowance_out(db, row, account_id))
    return caregivers, speakers
