from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models import SessionAnalytics
from ownership import Owner, get_owned_or_404, owned, require_feature
from schemas import ProfileMode, SessionAnalyticsInput, SessionAnalyticsOut, SessionSummary

# Session history is a Pro feature: every route needs it, reading as well as recording.
router = APIRouter(prefix="/api/sessions", tags=["session-analytics"], dependencies=[require_feature("analytics")])

DbSession = Annotated[Session, Depends(get_db)]


def get_session_or_404(db: Session, session_id: str, owner: str | None) -> SessionAnalytics:
    return get_owned_or_404(db, SessionAnalytics, session_id, owner, "Session")


def weighted_mean(weighted_sum: float, weight: float, fallback: float) -> float:
    return round(weighted_sum / weight if weight > 0 else fallback, 3)


@router.get("", response_model=list[SessionAnalyticsOut])
def list_sessions(
    db: DbSession,
    owner: Owner,
    profileMode: ProfileMode | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[SessionAnalyticsOut]:
    query = owned(select(SessionAnalytics), SessionAnalytics, owner).order_by(SessionAnalytics.recordedAt.desc(), SessionAnalytics.id)
    if profileMode is not None:
        query = query.where(SessionAnalytics.profileMode == profileMode)
    records = db.scalars(query.limit(limit).offset(offset))
    return [SessionAnalyticsOut.model_validate(record) for record in records]


@router.get("/summary", response_model=SessionSummary)
def summarize_sessions(db: DbSession, owner: Owner, profileMode: ProfileMode | None = None) -> SessionSummary:
    """Totals over all recorded sessions. A long session counts for more than a short one in the averages."""
    duration = SessionAnalytics.sessionDurationSeconds
    blocks = SessionAnalytics.stutterCount
    query = select(
        func.count(SessionAnalytics.id).label("sessions"),
        func.coalesce(func.sum(duration), 0).label("seconds"),
        func.coalesce(func.sum(blocks), 0).label("stutters"),
        func.coalesce(func.sum(SessionAnalytics.wpm * duration), 0.0).label("wpm_seconds"),
        func.coalesce(func.sum(SessionAnalytics.fluencyPercentage * duration), 0.0).label("fluency_seconds"),
        func.coalesce(func.sum(SessionAnalytics.avgBlockDurationMs * blocks), 0.0).label("block_ms"),
        func.coalesce(func.avg(SessionAnalytics.wpm), 0.0).label("mean_wpm"),
        func.coalesce(func.avg(SessionAnalytics.fluencyPercentage), 0.0).label("mean_fluency"),
        func.min(SessionAnalytics.recordedAt).label("first"),
        func.max(SessionAnalytics.recordedAt).label("last"),
    )
    query = owned(query, SessionAnalytics, owner)
    if profileMode is not None:
        query = query.where(SessionAnalytics.profileMode == profileMode)
    row = db.execute(query).one()
    return SessionSummary(
        profileMode=profileMode,
        sessions=row.sessions,
        totalSeconds=row.seconds,
        totalStutters=row.stutters,
        # Sessions that all lasted 0 s have no length to weight by, so they fall back to a plain mean.
        averageWpm=weighted_mean(row.wpm_seconds, row.seconds, row.mean_wpm),
        averageFluencyPercentage=weighted_mean(row.fluency_seconds, row.seconds, row.mean_fluency),
        averageBlockDurationMs=weighted_mean(row.block_ms, row.stutters, 0.0),
        firstRecordedAt=row.first,
        lastRecordedAt=row.last,
    )


@router.post("", response_model=SessionAnalyticsOut, status_code=status.HTTP_201_CREATED)
def record_session(payload: SessionAnalyticsInput, db: DbSession, owner: Owner) -> SessionAnalyticsOut:
    record = SessionAnalytics(**payload.model_dump(), userId=owner)
    db.add(record)
    db.commit()
    return SessionAnalyticsOut.model_validate(record)


@router.get("/{session_id}", response_model=SessionAnalyticsOut)
def get_session(session_id: str, db: DbSession, owner: Owner) -> SessionAnalyticsOut:
    return SessionAnalyticsOut.model_validate(get_session_or_404(db, session_id, owner))


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, db: DbSession, owner: Owner) -> Response:
    db.delete(get_session_or_404(db, session_id, owner))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
