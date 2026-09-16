"""The language-model agents' HTTP surface.

- GET  /api/agent/status           which providers are configured (the website hides the widget otherwise)
- POST /api/agent/chat             the onboarding assistant, with its tool calls listed in the answer
- POST /api/agent/generate-report  session log -> ClinicalReport (Voicematics Pro: clinical_reports)
- POST /api/agent/compile-grammar  plain-text request -> validated rules appended to grammars/user_custom.cfg
                                   (signed in; only a local-mode install may save to that shared file)

All three agents run on the thread pool (the model calls block) and answer 503 when no provider is
configured. Requests are rate limited per client address because every call costs model tokens.
"""

import logging
import threading
import time
from collections import OrderedDict, deque
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from pydantic_ai.exceptions import AgentRunError, UnexpectedModelBehavior

from agents import assistant, cfg_compiler, telemetry_reporter
from agents.llm import AgentUnavailable, agent_model, configured_providers
from config import get_settings
from ownership import CurrentAccount, require_feature

router = APIRouter(prefix="/api/agent", tags=["agents"])
log = logging.getLogger("agents")


class AgentStatus(BaseModel):
    available: bool
    providers: list[Literal["gemini", "groq"]]
    primary: Literal["gemini", "groq"] | None


class CompileGrammarRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=cfg_compiler.MAX_REQUEST_CHARS)
    save: bool = True


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


rate_limiter = RateLimiter(get_settings().AGENT_RATE_LIMIT_PER_MINUTE)


def limited(request: Request) -> None:
    client = request.client.host if request.client else "unknown"
    wait = rate_limiter.retry_after(client)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many agent requests. Try again shortly.",
            headers={"Retry-After": str(wait)},
        )


Limited = Annotated[None, Depends(limited)]


def require_model():
    try:
        return agent_model()
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


@router.post("/chat", response_model=assistant.ChatResponse)
def chat(payload: assistant.ChatRequest, _: Limited) -> assistant.ChatResponse:
    model = require_model()
    return run(assistant.chat, payload, model=model)


@router.post("/generate-report", response_model=telemetry_reporter.ClinicalReport)
def generate_report(
    payload: telemetry_reporter.SessionLog, _: Limited, __: Annotated[None, require_feature("clinical_reports")]
) -> telemetry_reporter.ClinicalReport:
    model = require_model()
    return run(telemetry_reporter.generate_report, payload, model=model)


@router.post("/compile-grammar", response_model=cfg_compiler.CompiledGrammar)
def compile_grammar(payload: CompileGrammarRequest, _: Limited, account: CurrentAccount) -> cfg_compiler.CompiledGrammar:
    model = require_model()
    # grammars/user_custom.cfg is one file for the whole server, so accounts on a hosted backend only get the
    # validated rules back; the answer's `saved` says which happened.
    save = payload.save and account.id is None
    return run(cfg_compiler.compile_grammar, payload.prompt, model=model, save=save)
