"""Tables in web_users.db. Attribute names are camelCase like models.py; column names stay snake_case."""

from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models import choice, new_id, utcnow
from web_auth.database import WebBase

PlanTier = Literal["free", "pro", "lifetime"]

# "VM-XXXX-YYYY-ZZZZ"
LICENSE_KEY_LENGTH = 17


class WebUser(WebBase):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    # Stored lower-case, so uniqueness ignores case.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    # Full Argon2id encoding: algorithm, parameters, salt and hash.
    passwordHash: Mapped[str] = mapped_column("password_hash", String(255))
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)
    planTier: Mapped[str] = mapped_column("plan_tier", choice(PlanTier, "ck_users_plan_tier"), default="free")
    # The account's current key; older keys stay in license_keys but no longer validate.
    licenseKey: Mapped[str | None] = mapped_column("license_key", String(LICENSE_KEY_LENGTH), unique=True)
    isActive: Mapped[bool] = mapped_column("is_active", Boolean, default=True)

    licenses: Mapped[list["LicenseKey"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class LicenseKey(WebBase):
    __tablename__ = "license_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    keyString: Mapped[str] = mapped_column("key_string", String(LICENSE_KEY_LENGTH), unique=True)
    userId: Mapped[str] = mapped_column("user_id", ForeignKey("users.id", ondelete="CASCADE"), index=True)
    tier: Mapped[str] = mapped_column(choice(PlanTier, "ck_license_keys_tier"))
    # SHA-256 (hex) of the hardware id the desktop app sent on first activation; the raw id is never stored.
    hardwareIdBound: Mapped[str | None] = mapped_column("hardware_id_bound", String(64))
    activatedAt: Mapped[datetime | None] = mapped_column("activated_at", DateTime(timezone=True))

    user: Mapped[WebUser] = relationship(back_populates="licenses")


BillingPeriod = Literal["monthly", "annual", "lifetime"]
SubscriptionStatus = Literal["active", "replaced", "cancelled", "expired"]


class Subscription(WebBase):
    """A mock checkout result: which plan the account is on and how it was paid for. Only the card's brand
    and last four digits are kept."""

    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    userId: Mapped[str] = mapped_column("user_id", ForeignKey("users.id", ondelete="CASCADE"), index=True)
    planId: Mapped[str] = mapped_column("plan_id", String(32))
    tier: Mapped[str] = mapped_column(choice(PlanTier, "ck_subscriptions_tier"))
    billingPeriod: Mapped[str] = mapped_column("billing_period", choice(BillingPeriod, "ck_subscriptions_billing_period"))
    amountCents: Mapped[int] = mapped_column("amount_cents", Integer)
    currency: Mapped[str] = mapped_column(String(3), default="usd")
    cardBrand: Mapped[str] = mapped_column("card_brand", String(16))
    cardLast4: Mapped[str] = mapped_column("card_last4", String(4))
    status: Mapped[str] = mapped_column(choice(SubscriptionStatus, "ck_subscriptions_status"), default="active")
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)
    # None for lifetime access.
    currentPeriodEnd: Mapped[datetime | None] = mapped_column("current_period_end", DateTime(timezone=True))
    licenseKey: Mapped[str] = mapped_column("license_key", String(LICENSE_KEY_LENGTH))

    user: Mapped[WebUser] = relationship()


class DeviceSession(WebBase):
    """A desktop app that stays signed in. It trades its secret for a fresh session token whenever the short-lived
    token runs out, so nobody retypes a password every day. Only the SHA-256 of the secret is stored, the secret
    only works on the machine it was issued to, and signing out revokes it."""

    __tablename__ = "device_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    userId: Mapped[str] = mapped_column("user_id", ForeignKey("users.id", ondelete="CASCADE"), index=True)
    secretHash: Mapped[str] = mapped_column("secret_hash", String(64), unique=True)
    hardwareFingerprint: Mapped[str] = mapped_column("hardware_fingerprint", String(64))
    label: Mapped[str] = mapped_column(String(80), default="")
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)
    lastUsedAt: Mapped[datetime] = mapped_column("last_used_at", DateTime(timezone=True), default=utcnow)
    revokedAt: Mapped[datetime | None] = mapped_column("revoked_at", DateTime(timezone=True))


class Profile(WebBase):
    """The public side of an account: the username others use to approve it as a caregiver, a display name, and
    the answers to the sign-up interview (JSON, see schemas.OnboardingAnswers). Created with the account, or the
    first time an older account is read."""

    __tablename__ = "profiles"

    userId: Mapped[str] = mapped_column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Stored lower-case, so uniqueness ignores case (web_auth/profiles.py validates the shape).
    username: Mapped[str] = mapped_column(String(20), unique=True)
    displayName: Mapped[str] = mapped_column("display_name", String(40), default="")
    onboarding: Mapped[str | None] = mapped_column(Text)
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)
    updatedAt: Mapped[datetime] = mapped_column("updated_at", DateTime(timezone=True), default=utcnow)

    # So a new account and its profile are inserted in that order in one commit.
    user: Mapped[WebUser] = relationship()


AllowanceStatus = Literal["pending", "approved", "denied"]


class CaregiverAllowance(WebBase):
    """Whether a speaker lets another account watch them over the caregiver link. A room code alone is not enough:
    the relay admits a caregiver only with an approved allowance from the room's speaker."""

    __tablename__ = "caregiver_allowances"
    __table_args__ = (UniqueConstraint("speaker_id", "caregiver_id", name="uq_caregiver_allowances_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    speakerId: Mapped[str] = mapped_column("speaker_id", ForeignKey("users.id", ondelete="CASCADE"), index=True)
    caregiverId: Mapped[str] = mapped_column("caregiver_id", ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(choice(AllowanceStatus, "ck_caregiver_allowances_status"), default="pending")
    createdAt: Mapped[datetime] = mapped_column("created_at", DateTime(timezone=True), default=utcnow)
    decidedAt: Mapped[datetime | None] = mapped_column("decided_at", DateTime(timezone=True))
