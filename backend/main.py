import gc
import math
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import grammar_engine
from config import get_settings
from database import init_db
from routers import agents as agent_routes
from routers import auth, billing, phonemes, presets, sessions, signalling, triggers
from web_auth.database import init_web_db

# Garbled SOV probe so the healthcheck exercises normalization, parsing, ranking and reordering.
PROBE_TOKENS = ["um", "me", "w-w-water", "want"]
PROBE_EXPECTED = "I want water."

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


def time_probe_parse() -> float:
    # Always a full chart parse, so the reported latency is never a cache hit.
    result = grammar_engine.translate(PROBE_TOKENS, use_cache=False)
    if result.formatted_text != PROBE_EXPECTED:
        raise RuntimeError(f"AST engine probe returned {result.formatted_text!r}, expected {PROBE_EXPECTED!r}")
    return result.latency_ms


def json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def uptime_seconds(request: Request) -> float:
    return round(time.monotonic() - request.app.state.started_monotonic, 3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.started_at = datetime.now(timezone.utc)
    app.state.started_monotonic = time.monotonic()
    init_db()
    init_web_db()
    # Warm-up parse: fails startup on a broken grammar and keeps the first healthcheck from reading cold.
    time_probe_parse()
    grammar_engine.warm_parse_cache()
    # Exempt the startup heap from GC scans; full collections over it stalled parses by 10-30ms.
    gc.collect()
    gc.freeze()
    yield


app = FastAPI(title="Voicematics API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[grammar_engine.UNPARSED_HEADER],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # Same body as FastAPI's default, but the echoed input may hold NaN/Infinity (Python's JSON decoder
    # accepts them), which would otherwise make the 422 itself fail to serialize and surface as a 500.
    return JSONResponse(status_code=422, content={"detail": json_safe(jsonable_encoder(exc.errors()))})


app.include_router(grammar_engine.router)
app.include_router(triggers.router)
app.include_router(presets.router)
app.include_router(sessions.router)
app.include_router(phonemes.router)
app.include_router(signalling.router)
app.include_router(auth.router)
app.include_router(auth.license_router)
app.include_router(billing.router)
app.include_router(agent_routes.router)


@app.get("/health/live", response_model=LiveHealth)
def health_live(request: Request) -> LiveHealth:
    return LiveHealth(
        status="ok",
        uptimeSeconds=uptime_seconds(request),
        startedAt=request.app.state.started_at,
    )


@app.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    latency_ms = time_probe_parse()
    within_budget = latency_ms <= grammar_engine.LATENCY_BUDGET_MS
    return HealthResponse(
        status="ok" if within_budget else "degraded",
        uptimeSeconds=uptime_seconds(request),
        startedAt=request.app.state.started_at,
        astEngine=AstEngineHealth(
            latencyMs=round(latency_ms, 3),
            budgetMs=grammar_engine.LATENCY_BUDGET_MS,
            withinBudget=within_budget,
        ),
    )
