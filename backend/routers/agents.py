"""The language-model agent's HTTP surface. There is one agent: the ClearVoice sentence refiner.

- GET  /api/agent/status           which providers are configured
- POST /api/agent/refine-sentence  words + the grammar engine's sentence + recent sentences -> the
                                   context-aware rebuild shown under the rule-based one

The agent runs on the thread pool (the model calls block) and answers 503 when no provider is configured.
Requests are rate limited per client address because every call costs model tokens; the allowance is sized for
one call per spoken sentence.
"""

import logging
import threading
import time
from collections import OrderedDict, deque
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from pydantic_ai.exceptions import AgentRunError, UnexpectedModelBehavior

from agents import sentence_refiner
from agents.llm import AgentUnavailable, configured_providers, refine_model
from config import get_settings
from ownership import CurrentAccount, plan_required

router = APIRouter(prefix="/api/agent", tags=["agents"])
log = logging.getLogger("agents")


class AgentStatus(BaseModel):
    available: bool
    providers: list[Literal["gemini", "groq"]]
    primary: Literal["gemini", "groq"] | None


class RateLimiter:
    """Sliding one-minute window per key, in process memory."""

    def __init__(self, per_minute: int, max_tracked: int = 10_000) -> None:
        self.per_minute = per_minute
        self.max_tracked = max_tracked
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> int:
        """Seconds to wait, or 0 when the request may go ahead (in which case it is counted)."""
        with self._lock:
            now = time.monotonic()
            hits = self._hits.get(key)
            if hits is None:
                hits = deque()
            while hits and hits[0] <= now - 60:
                hits.popleft()
            if len(hits) >= self.per_minute:
                return max(1, int(hits[0] + 60 - now + 0.999))
            hits.append(now)
            self._hits[key] = hits
            self._hits.move_to_end(key)
            while len(self._hits) > self.max_tracked:
                self._hits.popitem(last=False)
            return 0

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


refine_rate_limiter = RateLimiter(get_settings().REFINE_RATE_LIMIT_PER_MINUTE)


def refine_limited(request: Request) -> None:
    client = request.client.host if request.client else "unknown"
    wait = refine_rate_limiter.retry_after(client)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sentences in a minute. Try again shortly.",
            headers={"Retry-After": str(wait)},
        )


RefineLimited = Annotated[None, Depends(refine_limited)]


def require_model(select=refine_model):
    try:
        return select()
    except AgentUnavailable as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from None


def run(action, *args, **kwargs):
    try:
        return action(*args, **kwargs)
    except (UnexpectedModelBehavior, AgentRunError) as error:
        log.warning("agent run failed: %s", error)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"The language model did not answer usably: {error}") from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None


@router.get("/status", response_model=AgentStatus)
def agent_status() -> AgentStatus:
    providers = configured_providers()
    return AgentStatus(available=bool(providers), providers=providers, primary=providers[0] if providers else None)


@router.post("/refine-sentence", response_model=sentence_refiner.RefinedSentence)
def refine_sentence(payload: sentence_refiner.SentenceRefineRequest, _: RefineLimited, account: CurrentAccount) -> sentence_refiner.RefinedSentence:
    # ClearVoice is on every plan, so this mostly means "signed in" when accounts are required.
    if not account.has("clearvoice"):
        raise plan_required("clearvoice")
    model = require_model(refine_model)
    return run(sentence_refiner.refine_sentence, payload, model=model)
