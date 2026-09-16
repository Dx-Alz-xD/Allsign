import threading
import time
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import acoustic_matcher as am
from database import get_db
from models import AcousticTrigger
from schemas import (
    AcousticMatchCandidate,
    AcousticMatchRequest,
    AcousticMatchResponse,
    AcousticTriggerCreate,
    AcousticTriggerOut,
    AcousticTriggerUpdate,
    TriggerAction,
)

router = APIRouter(prefix="/api/triggers", tags=["acoustic-triggers"])

DbSession = Annotated[Session, Depends(get_db)]
# Stale fingerprints are fetched in chunks well under SQLite's bound-parameter limit.
FETCH_CHUNK = 500


class TriggerProfileCache:
    """Spectral profiles of stored triggers, so a match request does not re-profile every fingerprint.

    Writes through this router invalidate entries directly. Every insert, edit or delete also changes the
    trigger count or the newest `updatedAt`, so an unchanged pair means the cached templates are current
    and the per-trigger query is skipped. Profiles are per process, so run the API with a single worker.
    """

    def __init__(self) -> None:
        self._profiles: dict[str, tuple[datetime, am.SpectralProfile]] = {}
        self._templates: tuple[am.TriggerTemplate, ...] = ()
        self._snapshot: tuple | None = None
        self._lock = threading.Lock()

    def clear(self) -> None:
        with self._lock:
            self._profiles.clear()
            self._templates = ()
            self._snapshot = None

    def invalidate(self, trigger_id: str) -> None:
        with self._lock:
            self._profiles.pop(trigger_id, None)
            self._snapshot = None

    def templates(self, db: Session) -> tuple[am.TriggerTemplate, ...]:
        snapshot = tuple(db.execute(select(func.count(AcousticTrigger.id), func.max(AcousticTrigger.updatedAt))).one())
        with self._lock:
            if snapshot == self._snapshot:
                return self._templates
            # A write landing after the snapshot above only makes the next request refresh again.
            rows = db.execute(
                select(AcousticTrigger.id, AcousticTrigger.updatedAt, AcousticTrigger.threshold).order_by(
                    AcousticTrigger.createdAt, AcousticTrigger.id
                )
            ).all()
            stale = [row.id for row in rows if self._profiles.get(row.id, (None,))[0] != row.updatedAt]
            for chunk_start in range(0, len(stale), FETCH_CHUNK):
                fetched = db.execute(
                    select(AcousticTrigger.id, AcousticTrigger.updatedAt, AcousticTrigger.spectralFingerprint).where(
                        AcousticTrigger.id.in_(stale[chunk_start : chunk_start + FETCH_CHUNK])
                    )
                )
                for row in fetched:
                    self._profiles[row.id] = (row.updatedAt, am.spectral_profile(row.spectralFingerprint))
            live = {row.id for row in rows}
            for trigger_id in self._profiles.keys() - live:
                del self._profiles[trigger_id]
            # A trigger deleted between the two queries has no profile and is simply skipped.
            self._templates = tuple(
                am.TriggerTemplate(row.id, self._profiles[row.id][1], row.threshold)
                for row in rows
                if row.id in self._profiles
            )
            self._snapshot = snapshot
            return self._templates


profile_cache = TriggerProfileCache()


def get_trigger_or_404(db: Session, trigger_id: str) -> AcousticTrigger:
    trigger = db.get(AcousticTrigger, trigger_id)
    if trigger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Acoustic trigger '{trigger_id}' not found")
    return trigger


def apply_changes(db: Session, trigger: AcousticTrigger, changes: dict) -> AcousticTriggerOut:
    for field, value in changes.items():
        setattr(trigger, field, value)
    db.commit()
    profile_cache.invalidate(trigger.id)
    return AcousticTriggerOut.model_validate(trigger)


@router.get("", response_model=list[AcousticTriggerOut])
def list_triggers(
    db: DbSession,
    targetAction: TriggerAction | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AcousticTriggerOut]:
    query = select(AcousticTrigger).order_by(AcousticTrigger.createdAt, AcousticTrigger.id)
    if targetAction is not None:
        query = query.where(AcousticTrigger.targetAction == targetAction)
    triggers = db.scalars(query.limit(limit).offset(offset))
    return [AcousticTriggerOut.model_validate(trigger) for trigger in triggers]


@router.post("", response_model=AcousticTriggerOut, status_code=status.HTTP_201_CREATED)
def create_trigger(payload: AcousticTriggerCreate, db: DbSession) -> AcousticTriggerOut:
    trigger = AcousticTrigger(**payload.model_dump())
    db.add(trigger)
    db.commit()
    return AcousticTriggerOut.model_validate(trigger)


@router.post("/match", response_model=AcousticMatchResponse)
def match_trigger(payload: AcousticMatchRequest, db: DbSession) -> AcousticMatchResponse:
    """Rank stored triggers against one 128-bin power spectrum (acoustic_matcher FFT peak matching).

    score blends envelope-shape cosine similarity, in-band energy and peak overlap; distance = 1 - score.
    Only the best candidate can fire, and only when its score reaches that trigger's own threshold.
    """
    start = time.perf_counter()
    query, ranked = am.rank(payload.spectralFingerprint, profile_cache.templates(db), payload.topK)
    ids = [entry.template.trigger_id for entry in ranked]
    details = {
        row.id: row
        for row in db.execute(
            select(
                AcousticTrigger.id, AcousticTrigger.name, AcousticTrigger.mappedPhrase, AcousticTrigger.targetAction
            ).where(AcousticTrigger.id.in_(ids))
        )
    } if ids else {}

    candidates = []
    for entry in ranked:
        row = details.get(entry.template.trigger_id)
        if row is None:
            continue
        score = min(1.0, max(0.0, entry.score))
        candidates.append(AcousticMatchCandidate(
            triggerId=row.id,
            name=row.name,
            mappedPhrase=row.mappedPhrase,
            targetAction=row.targetAction,
            threshold=entry.template.threshold,
            score=round(score, 6),
            distance=round(1.0 - score, 6),
        ))
    best = ranked[0] if ranked else None
    matched = best is not None and best.template.trigger_id in details and best.score >= best.template.threshold
    return AcousticMatchResponse(
        matched=matched,
        trigger=candidates[0] if matched else None,
        candidates=candidates,
        levelDb=round(query.level_db, 3),
        silent=query.level_db < am.SILENCE_FLOOR_DB,
        executionLatencyMs=round((time.perf_counter() - start) * 1000, 3),
    )


@router.get("/{trigger_id}", response_model=AcousticTriggerOut)
def get_trigger(trigger_id: str, db: DbSession) -> AcousticTriggerOut:
    return AcousticTriggerOut.model_validate(get_trigger_or_404(db, trigger_id))


@router.put("/{trigger_id}", response_model=AcousticTriggerOut)
def replace_trigger(trigger_id: str, payload: AcousticTriggerCreate, db: DbSession) -> AcousticTriggerOut:
    return apply_changes(db, get_trigger_or_404(db, trigger_id), payload.model_dump())


@router.patch("/{trigger_id}", response_model=AcousticTriggerOut)
def update_trigger(trigger_id: str, payload: AcousticTriggerUpdate, db: DbSession) -> AcousticTriggerOut:
    return apply_changes(db, get_trigger_or_404(db, trigger_id), payload.model_dump(exclude_unset=True))


@router.delete("/{trigger_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trigger(trigger_id: str, db: DbSession) -> Response:
    db.delete(get_trigger_or_404(db, trigger_id))
    db.commit()
    profile_cache.invalidate(trigger_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
