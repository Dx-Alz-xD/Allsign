"""Plans, the features each one unlocks, and when a subscription stops counting.

This is the single source of truth for entitlements: the desktop app and the website ask the backend which
features an account has (AccountResponse.features, LicenseVerifyResponse.features) and gate their UI on
that list. shared/types.ts mirrors the Feature names.
"""

from datetime import datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import utcnow
from web_auth.models import PlanTier, Subscription, WebUser

Feature = Literal[
    "clearvoice",  # grammar reconstruction and direct paste
    "aphasia",  # word finder and reconstruction
    "sensory",  # sensory HUD
    "vocal_assist",  # acoustic triggers (limited on Free)
    "fluency",  # DAF / FSF Fluency Coach
    "therapy",  # vowel plane and articulation targets
    "unlimited_triggers",
    "caregiver_link",
    "analytics",  # session history and summaries
]

FREE_FEATURES: tuple[Feature, ...] = ("clearvoice", "aphasia", "sensory", "vocal_assist")
PRO_FEATURES: tuple[Feature, ...] = FREE_FEATURES + (
    "fluency",
    "therapy",
    "unlimited_triggers",
    "caregiver_link",
    "analytics",
)
PLAN_FEATURES: dict[str, tuple[Feature, ...]] = {"free": FREE_FEATURES, "pro": PRO_FEATURES, "lifetime": PRO_FEATURES}
FREE_TRIGGER_LIMIT = 1
# What people see when a plan does not include a feature.
FEATURE_NAMES: dict[str, str] = {
    "clearvoice": "ClearVoice",
    "aphasia": "Aphasia Mode",
    "sensory": "Sensory HUD",
    "vocal_assist": "Vocal Assist triggers",
    "fluency": "Fluency Coach",
    "therapy": "Therapy Mode",
    "unlimited_triggers": "Unlimited triggers",
    "caregiver_link": "Caregiver Link",
    "analytics": "Session analytics",
}
# The feature a saved profile preset needs; Pitch Demo is for presentations and open to everyone.
PROFILE_FEATURES: dict[str, Feature | None] = {
    "clearvoice": "clearvoice",
    "fluency": "fluency",
    "vocal_assist": "vocal_assist",
    "therapy": "therapy",
    "aphasia": "aphasia",
    "sensory": "sensory",
    "pitch_demo": None,
}
# Subscriptions that count as paid access until their period ends.
PAID_STATUSES = frozenset({"active", "cancelled"})


def features_for(tier: str) -> list[Feature]:
    return list(PLAN_FEATURES.get(tier, FREE_FEATURES))


def trigger_limit_for(tier: str) -> int | None:
    """None means unlimited."""
    return None if "unlimited_triggers" in PLAN_FEATURES.get(tier, FREE_FEATURES) else FREE_TRIGGER_LIMIT


def current_subscription(db: Session, user: WebUser) -> Subscription | None:
    return db.scalar(
        select(Subscription)
        .where(Subscription.userId == user.id, Subscription.status.in_(PAID_STATUSES))
        .order_by(Subscription.createdAt.desc())
    )


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=utcnow().tzinfo)


def settle_plan(db: Session, user: WebUser, now: datetime | None = None) -> tuple[str, Subscription | None]:
    """The tier the account is really on right now, after expiring a lapsed subscription.

    A monthly or annual subscription whose period has ended (whether it was cancelled or simply not
    renewed by this mock billing) drops the account back to the free tier. Lifetime access has no end.
    """
    moment = now or utcnow()
    subscription = current_subscription(db, user)
    if subscription is not None and subscription.currentPeriodEnd is not None and _as_utc(subscription.currentPeriodEnd) <= moment:
        subscription.status = "expired"
        user.planTier = "free"
        db.commit()
        subscription = None
    if subscription is None and user.planTier != "free":
        # A paid tier with no live subscription (e.g. set by hand): keep it, this mock has no processor to ask.
        return user.planTier, None
    return user.planTier, subscription


def plan_expires_at(subscription: Subscription | None) -> datetime | None:
    return subscription.currentPeriodEnd if subscription is not None else None


__all__ = [
    "FEATURE_NAMES",
    "FREE_TRIGGER_LIMIT",
    "Feature",
    "PLAN_FEATURES",
    "PROFILE_FEATURES",
    "PlanTier",
    "current_subscription",
    "features_for",
    "plan_expires_at",
    "settle_plan",
    "trigger_limit_for",
]
