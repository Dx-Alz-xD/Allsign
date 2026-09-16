from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import AcousticTrigger
from schemas import AcousticTriggerCreate, AcousticTriggerOut, AcousticTriggerUpdate, TriggerAction

router = APIRouter(prefix="/api/triggers", tags=["acoustic-triggers"])

DbSession = Annotated[Session, Depends(get_db)]


def get_trigger_or_404(db: Session, trigger_id: str) -> AcousticTrigger:
    trigger = db.get(AcousticTrigger, trigger_id)
    if trigger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Acoustic trigger '{trigger_id}' not found")
    return trigger


def apply_changes(db: Session, trigger: AcousticTrigger, changes: dict) -> AcousticTriggerOut:
    for field, value in changes.items():
        setattr(trigger, field, value)
    db.commit()
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
    return Response(status_code=status.HTTP_204_NO_CONTENT)
