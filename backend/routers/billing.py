"""Mock subscription checkout for the Voicematics website.

- GET  /api/billing/plans          the pricing matrix (the website renders exactly this)
- POST /api/billing/checkout       signed in: "pay" with a test card, record the subscription, upgrade the
                                   account's plan tier and issue a licence key for that tier
- GET  /api/billing/subscription   signed in: the current subscription, or null on the free plan

No payment processor is involved. The card number must pass a Luhn check and the expiry must be in the
future; Stripe's decline test number is declined so the website can show that path. Only the card brand and
last four digits are stored, and the number is never logged.
"""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import get_settings
from models import utcnow
from routers.auth import license_info, signed_in_user
from schemas import CardBrand, CardDetails, CheckoutRequest, CheckoutResponse, PricingPlan, SubscriptionOut, WebUserOut
from web_auth.database import get_web_db
from web_auth.licenses import generate_license_key
from web_auth.models import LicenseKey, Subscription, WebUser

router = APIRouter(prefix="/api/billing", tags=["web-billing"])

WebDb = Annotated[Session, Depends(get_web_db)]
SignedIn = Annotated[WebUser, Depends(signed_in_user)]

DECLINED_TEST_NUMBERS = frozenset({"4000000000000002", "4000000000009995"})
KEY_ATTEMPTS = 5
MONTH_DAYS = 30
YEAR_DAYS = 365

PLANS: list[PricingPlan] = [
    PricingPlan(
        id="free",
        tier="free",
        name="Free",
        priceCents=0,
        billingPeriod=None,
        features=["ClearVoice grammar reconstruction", "Sensory HUD", "One acoustic trigger", "Community support"],
    ),
    PricingPlan(
        id="pro_monthly",
        tier="pro",
        name="Pro Monthly",
        priceCents=1499,
        billingPeriod="monthly",
        features=["Everything in Free", "DAF / FSF Fluency Coach", "Unlimited triggers", "Caregiver link", "Session analytics"],
    ),
    PricingPlan(
        id="pro_annual",
        tier="pro",
        name="Pro Annual",
        priceCents=12900,
        billingPeriod="annual",
        features=["Everything in Pro Monthly", "Two months free", "Priority support"],
    ),
    PricingPlan(
        id="lifetime",
        tier="lifetime",
        name="Lifetime Access",
        priceCents=29900,
        billingPeriod="lifetime",
        features=["Everything in Pro", "One payment, every future release", "Licence bound to your machine, transferable on request"],
    ),
]
PLAN_BY_ID = {plan.id: plan for plan in PLANS}


def luhn_valid(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def card_brand(digits: str) -> CardBrand:
    if digits.startswith("4"):
        return "visa"
    if digits[:2] in {"34", "37"}:
        return "amex"
    two, four = int(digits[:2]), int(digits[:4])
    if 51 <= two <= 55 or 2221 <= four <= 2720:
        return "mastercard"
    return "card"


def validate_card(card: CardDetails) -> tuple[CardBrand, str]:
    """Returns (brand, last4) or raises 402 with a reason that never echoes the number."""
    digits = card.number.replace(" ", "").replace("-", "")
    declined = HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Your card was declined.")
    if not digits.isdigit() or not 13 <= len(digits) <= 19 or not luhn_valid(digits):
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Your card number is invalid.")
    now = utcnow()
    if (card.expYear, card.expMonth) < (now.year, now.month):
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Your card has expired.")
    if digits in DECLINED_TEST_NUMBERS:
        raise declined
    return card_brand(digits), digits[-4:]


def period_end(billing_period: str):
    now = utcnow()
    if billing_period == "monthly":
        return now + timedelta(days=MONTH_DAYS)
    if billing_period == "annual":
        return now + timedelta(days=YEAR_DAYS)
    return None


def current_subscription(db: Session, user: WebUser) -> Subscription | None:
    return db.scalar(
        select(Subscription)
        .where(Subscription.userId == user.id, Subscription.status == "active")
        .order_by(Subscription.createdAt.desc())
    )


@router.get("/plans", response_model=list[PricingPlan])
def plans() -> list[PricingPlan]:
    return PLANS


@router.get("/subscription", response_model=SubscriptionOut | None)
def subscription(user: SignedIn, db: WebDb) -> SubscriptionOut | None:
    record = current_subscription(db, user)
    return SubscriptionOut.model_validate(record) if record else None


@router.post("/checkout", response_model=CheckoutResponse, status_code=status.HTTP_201_CREATED)
def checkout(payload: CheckoutRequest, user: SignedIn, db: WebDb) -> CheckoutResponse:
    plan = PLAN_BY_ID[payload.planId]
    if user.planTier == "lifetime":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This account already has lifetime access.")
    brand, last4 = validate_card(payload.card)

    previous = current_subscription(db, user)

    for _ in range(KEY_ATTEMPTS):
        if previous is not None:
            previous.status = "replaced"
        key_string = generate_license_key()
        key = LicenseKey(keyString=key_string, userId=user.id, tier=plan.tier)
        record = Subscription(
            userId=user.id,
            planId=plan.id,
            tier=plan.tier,
            billingPeriod=plan.billingPeriod,
            amountCents=plan.priceCents,
            currency="usd",
            cardBrand=brand,
            cardLast4=last4,
            status="active",
            currentPeriodEnd=period_end(plan.billingPeriod),
            licenseKey=key_string,
        )
        user.planTier = plan.tier
        user.licenseKey = key_string
        db.add_all([key, record])
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(user)
        return CheckoutResponse(
            subscription=SubscriptionOut.model_validate(record),
            license=license_info(user, key),
            user=WebUserOut.model_validate(user),
            downloadUrl=get_settings().INSTALLER_DOWNLOAD_URL,
        )
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not allocate a license key.")
