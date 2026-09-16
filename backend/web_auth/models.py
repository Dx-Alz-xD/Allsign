"""Tables in web_users.db. Attribute names are camelCase like models.py; column names stay snake_case."""

from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
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
