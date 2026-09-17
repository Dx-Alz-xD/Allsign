"""Which model the agents talk to.

Gemini is the default. When a Gemini request fails for any reason (bad key, rate limit, outage, timeout)
the same request is retried on Groq. With only one key set that provider is used alone; with none the
agents are unavailable and the API says so instead of guessing.
"""

from functools import lru_cache

from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.groq import GroqProvider

from config import get_settings

GEMINI = "gemini"
GROQ = "groq"


class AgentUnavailable(RuntimeError):
    """No language-model provider is configured."""


def configured_providers() -> list[str]:
    """Provider names with a key in .env, in the order they are tried."""
    settings = get_settings()
    names = []
    if settings.GEMINI_API_KEY.get_secret_value():
        names.append(GEMINI)
    if settings.GROQ_API_KEY.get_secret_value():
        names.append(GROQ)
    return names


def _any_failure(exc: Exception) -> bool:
    # "If Gemini does not work, use Groq": every failure of the first provider moves to the next one.
    return True


def build_model(gemini_fallbacks: tuple[str, ...] = ()) -> Model:
    """gemini_fallbacks: more Gemini models to try, in order, before Groq."""
    settings = get_settings()
    models: list[Model] = []
    if settings.GEMINI_API_KEY.get_secret_value():
        provider = GoogleProvider(api_key=settings.GEMINI_API_KEY.get_secret_value())
        for name in dict.fromkeys((settings.GEMINI_MODEL, *gemini_fallbacks)):
            if name:
                models.append(GoogleModel(name, provider=provider))
    if settings.GROQ_API_KEY.get_secret_value():
        provider = GroqProvider(api_key=settings.GROQ_API_KEY.get_secret_value())
        models.append(GroqModel(settings.GROQ_MODEL, provider=provider))
    if not models:
        raise AgentUnavailable("No language model is configured. Set GEMINI_API_KEY or GROQ_API_KEY in backend/.env.")
    if len(models) == 1:
        return models[0]
    return FallbackModel(models[0], *models[1:], fallback_on=_any_failure)


@lru_cache(maxsize=1)
def agent_model() -> Model:
    return build_model()


@lru_cache(maxsize=1)
def refine_model() -> Model:
    """The sentence refiner runs once per spoken sentence, so a busy Gemini model falls back to a lighter one
    before Groq (GEMINI_REFINE_FALLBACK_MODEL)."""
    return build_model((get_settings().GEMINI_REFINE_FALLBACK_MODEL,))
