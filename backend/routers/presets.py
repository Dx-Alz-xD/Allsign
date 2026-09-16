from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import ProfilePreset
from ownership import Account, CurrentAccount, Owner, get_owned_or_404, owned, plan_required
from schemas import ProfileMode, ProfilePresetInput, ProfilePresetOut
from web_auth.plans import PROFILE_FEATURES

router = APIRouter(prefix="/api/presets", tags=["profile-presets"])

DbSession = Annotated[Session, Depends(get_db)]


def get_preset_or_404(db: Session, preset_id: str, owner: str | None) -> ProfilePreset:
    return get_owned_or_404(db, ProfilePreset, preset_id, owner, "Preset")


def check_mode_allowed(account: Account, mode: str) -> None:
    """Saving a preset for a profile needs the plan feature behind that profile."""
    feature = PROFILE_FEATURES.get(mode)
    if feature is not None and not account.has(feature):
        raise plan_required(feature)


@router.get("", response_model=list[ProfilePresetOut])
def list_presets(
    db: DbSession,
    owner: Owner,
    mode: ProfileMode | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ProfilePresetOut]:
    query = owned(select(ProfilePreset), ProfilePreset, owner).order_by(ProfilePreset.createdAt, ProfilePreset.id)
    if mode is not None:
        query = query.where(ProfilePreset.mode == mode)
    presets = db.scalars(query.limit(limit).offset(offset))
    return [ProfilePresetOut.model_validate(preset) for preset in presets]


@router.post("", response_model=ProfilePresetOut, status_code=status.HTTP_201_CREATED)
def create_preset(payload: ProfilePresetInput, db: DbSession, account: CurrentAccount) -> ProfilePresetOut:
    check_mode_allowed(account, payload.mode)
    preset = ProfilePreset(**payload.model_dump(), userId=account.id)
    db.add(preset)
    db.commit()
    return ProfilePresetOut.model_validate(preset)


@router.get("/{preset_id}", response_model=ProfilePresetOut)
def get_preset(preset_id: str, db: DbSession, owner: Owner) -> ProfilePresetOut:
    return ProfilePresetOut.model_validate(get_preset_or_404(db, preset_id, owner))


@router.put("/{preset_id}", response_model=ProfilePresetOut)
def replace_preset(preset_id: str, payload: ProfilePresetInput, db: DbSession, account: CurrentAccount) -> ProfilePresetOut:
    preset = get_preset_or_404(db, preset_id, account.id)
    check_mode_allowed(account, payload.mode)
    for field, value in payload.model_dump().items():
        setattr(preset, field, value)
    db.commit()
    return ProfilePresetOut.model_validate(preset)


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_preset(preset_id: str, db: DbSession, owner: Owner) -> Response:
    db.delete(get_preset_or_404(db, preset_id, owner))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
