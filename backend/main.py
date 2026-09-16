import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

import nltk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import get_settings

LATENCY_BUDGET_MS = 15.0

# Fixed probe for timing the CFG chart parser; grammar_engine.py owns the production rules.
PROBE_GRAMMAR = nltk.CFG.fromstring(
    """
    S -> NP VP
    NP -> Det N | Pron
    VP -> V NP | V
    Det -> 'the' | 'a'
    N -> 'message' | 'word'
    Pron -> 'i' | 'you'
    V -> 'need' | 'send'
    """
)
PROBE_TOKENS = ["i", "need", "the", "message"]

settings = get_settings()


class LiveHealth(BaseModel):
    status: Literal["ok"]
    uptimeSeconds: float
    startedAt: datetime


class AstEngineHealth(BaseModel):
    latencyMs: float
    budgetMs: float
    withinBudget: bool


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    uptimeSeconds: float
    startedAt: datetime
    astEngine: AstEngineHealth


def time_probe_parse(parser: nltk.ChartParser) -> float:
    start = time.perf_counter()
    tree = next(parser.parse(PROBE_TOKENS), None)
    elapsed_ms = (time.perf_counter() - start) * 1000
    if tree is None:
        raise RuntimeError("AST probe grammar produced no parse tree")
    return elapsed_ms


def uptime_seconds(request: Request) -> float:
    return round(time.monotonic() - request.app.state.started_monotonic, 3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.started_at = datetime.now(timezone.utc)
    app.state.started_monotonic = time.monotonic()
    app.state.probe_parser = nltk.ChartParser(PROBE_GRAMMAR)
    # Warm-up parse: fails startup on a broken grammar and keeps the first healthcheck from reading cold.
    time_probe_parse(app.state.probe_parser)
    yield


app = FastAPI(title="OmniVoice OS Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health/live", response_model=LiveHealth)
def health_live(request: Request) -> LiveHealth:
    return LiveHealth(
        status="ok",
        uptimeSeconds=uptime_seconds(request),
        startedAt=request.app.state.started_at,
    )


@app.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    latency_ms = time_probe_parse(request.app.state.probe_parser)
    within_budget = latency_ms <= LATENCY_BUDGET_MS
    return HealthResponse(
        status="ok" if within_budget else "degraded",
        uptimeSeconds=uptime_seconds(request),
        startedAt=request.app.state.started_at,
        astEngine=AstEngineHealth(
            latencyMs=round(latency_ms, 3),
            budgetMs=LATENCY_BUDGET_MS,
            withinBudget=within_budget,
        ),
    )
