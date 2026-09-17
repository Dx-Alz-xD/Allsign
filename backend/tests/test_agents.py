"""The sentence refiner, run against scripted models so no provider is called.

pydantic_ai.models.ALLOW_MODEL_REQUESTS is switched off for the whole module: a test that reached Gemini
or Groq would fail instead of spending tokens.
"""

import pytest
from pydantic_ai import models
from pydantic_ai.messages import ModelResponse, RetryPromptPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agents import sentence_refiner
from agents.llm import AgentUnavailable, build_model, configured_providers, refine_model
from config import get_settings
from routers import agents as agent_routes

models.ALLOW_MODEL_REQUESTS = False


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    agent_routes.refine_rate_limiter.clear()
    yield
    agent_routes.refine_rate_limiter.clear()


def final(args: dict) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name="final_result", args=args)])


def retry_text(messages) -> str | None:
    for part in messages[-1].parts:
        if isinstance(part, RetryPromptPart):
            return part.model_response()
    return None


# ---------------------------------------------------------------------------
# llm.py


def test_no_provider_means_unavailable(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GROQ_API_KEY", "")
    get_settings.cache_clear()
    try:
        assert configured_providers() == []
        with pytest.raises(AgentUnavailable):
            build_model()
    finally:
        get_settings.cache_clear()


def test_gemini_first_then_groq(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gem-test")
    monkeypatch.setenv("GROQ_API_KEY", "groq-test")
    get_settings.cache_clear()
    try:
        assert configured_providers() == ["gemini", "groq"]
        model = build_model()
        assert type(model).__name__ == "FallbackModel"
        assert [type(m).__name__ for m in model.models] == ["GoogleModel", "GroqModel"]
    finally:
        get_settings.cache_clear()


def test_refiner_tries_a_lighter_gemini_model_before_groq(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gem-test")
    monkeypatch.setenv("GROQ_API_KEY", "groq-test")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-flash-latest")
    monkeypatch.setenv("GEMINI_REFINE_FALLBACK_MODEL", "gemini-flash-lite-latest")
    get_settings.cache_clear()
    refine_model.cache_clear()
    try:
        model = refine_model()
        assert [(type(m).__name__, m.model_name) for m in model.models] == [
            ("GoogleModel", "gemini-flash-latest"),
            ("GoogleModel", "gemini-flash-lite-latest"),
            ("GroqModel", "llama-3.3-70b-versatile"),
        ]
    finally:
        get_settings.cache_clear()
        refine_model.cache_clear()


def test_single_provider_is_used_alone(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GROQ_API_KEY", "groq-test")
    get_settings.cache_clear()
    try:
        assert configured_providers() == ["groq"]
        assert type(build_model()).__name__ == "GroqModel"
    finally:
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# sentence_refiner.py: grounding


def test_said_vocabulary_splits_stutters_and_strips_endings():
    words = sentence_refiner.said_vocabulary(["w-w-water", "I-I-I", "wanted", "don't"], "Water wanted.")
    assert {"water", "wanted", "want", "don't", "i"} <= words
    # The stutter fragments are not words of their own.
    assert "w" not in words


@pytest.mark.parametrize(
    "sentence, tokens, draft, extra",
    [
        ("I want the water.", ["me", "w-w-water", "want"], "Me want water.", []),
        ("I want the water, please.", ["me", "water", "want"], "Me want water.", []),  # politeness words are grammar
        ("Turn the television on.", ["tevelision", "on"], "On tevelision.", ["turn"]),
        ("Television on.", ["tevelision", "on"], "On tevelision.", []),  # one sound off is the same word
        ("I would like a spoon.", ["fork", "want"], "Want fork.", ["like", "spoon"]),
        ("I am feeling cold today.", ["cold", "so", "so", "cold"], "So cold.", ["feeling", "today"]),
        ("She is walking home.", ["walk", "home"], "Walk home.", []),
    ],
)
def test_foreign_words_flags_only_content_words_that_were_not_said(sentence, tokens, draft, extra):
    assert sentence_refiner.foreign_words(sentence, tokens, draft) == extra


# ---------------------------------------------------------------------------
# sentence_refiner.py: the agent


def test_refiner_prompt_carries_the_words_the_rough_sentence_and_the_context():
    request = sentence_refiner.SentenceRefineRequest(
        rawTokens=["tevelision", "on"], draft="On tevelision.", profileMode="aphasia", context=["I am tired.", "I want to sit down."]
    )
    prompt = sentence_refiner.build_prompt(request)
    assert "<earlier>\n- I am tired.\n- I want to sit down.\n</earlier>" in prompt
    assert "<words>\ntevelision on\n</words>" in prompt
    assert "<rough>\nOn tevelision.\n</rough>" in prompt
    assert "(nothing yet)" in sentence_refiner.build_prompt(request.model_copy(update={"context": []}))


def test_refine_sentence_returns_the_models_sentence():
    seen: list[str] = []

    def scripted(messages, info: AgentInfo) -> ModelResponse:
        seen.append(str(messages[-1].parts[-1].content))
        return final({"sentence": "  Television   is on. "})

    request = sentence_refiner.SentenceRefineRequest(rawTokens=["tevelision", "on"], draft="On tevelision.", profileMode="aphasia")
    answer = sentence_refiner.refine_sentence(request, model=FunctionModel(scripted))
    assert answer.text == "Television is on."
    assert answer.modelName.startswith("function:")
    assert "tevelision on" in seen[0]


def test_refiner_sends_invented_words_back_and_takes_the_corrected_answer():
    answers = iter([final({"sentence": "Please turn the television on."}), final({"sentence": "Television on."})])
    retries: list[str] = []

    def scripted(messages, info: AgentInfo) -> ModelResponse:
        if (text := retry_text(messages)) is not None:
            retries.append(text)
        return next(answers)

    request = sentence_refiner.SentenceRefineRequest(rawTokens=["tevelision", "on"], draft="On tevelision.")
    answer = sentence_refiner.refine_sentence(request, model=FunctionModel(scripted))
    assert answer.text == "Television on."
    assert len(retries) == 1 and "turn" in retries[0] and "television" not in retries[0]


def test_refiner_falls_back_to_the_grammar_sentence_when_the_model_keeps_inventing():
    calls = {"n": 0}

    def scripted(messages, info: AgentInfo) -> ModelResponse:
        calls["n"] += 1
        return final({"sentence": "I would love a cold glass of lemonade."})

    request = sentence_refiner.SentenceRefineRequest(rawTokens=["me", "w-w-water", "want"], draft="Me  want water.")
    answer = sentence_refiner.refine_sentence(request, model=FunctionModel(scripted))
    assert answer.text == "Me want water."
    assert answer.modelName == sentence_refiner.GRAMMAR_FALLBACK_MODEL
    assert calls["n"] == 3  # the first answer and both retries


# ---------------------------------------------------------------------------
# routers/agents.py


def test_status_and_503_without_a_provider(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GROQ_API_KEY", "")
    get_settings.cache_clear()
    refine_model.cache_clear()
    try:
        status = client.get("/api/agent/status").json()
        assert status == {"available": False, "providers": [], "primary": None}
        response = client.post("/api/agent/refine-sentence", json={"rawTokens": ["hello"], "draft": "Hello."})
        assert response.status_code == 503
        assert "GEMINI_API_KEY" in response.json()["detail"]
    finally:
        get_settings.cache_clear()
        refine_model.cache_clear()


def test_refine_endpoint(client, monkeypatch):
    monkeypatch.setattr(agent_routes, "require_model", lambda select=None: FunctionModel(lambda m, i: final({"sentence": "I want to go to the store."})))
    body = {"rawTokens": "um i w-w-want to go the store".split(), "draft": "I want to go the store.", "context": ["Hi."]}
    response = client.post("/api/agent/refine-sentence", json=body)
    assert response.status_code == 200
    assert response.json() == {"text": "I want to go to the store.", "modelName": "function:<lambda>:"}

    assert client.post("/api/agent/refine-sentence", json={**body, "profileMode": "fluency"}).status_code == 422
    assert client.post("/api/agent/refine-sentence", json={**body, "rawTokens": []}).status_code == 422
    too_long = [f"Sentence {n}." for n in range(sentence_refiner.MAX_CONTEXT_SENTENCES + 1)]
    assert client.post("/api/agent/refine-sentence", json={**body, "context": too_long}).status_code == 422


def test_refine_rate_limit(client, monkeypatch):
    monkeypatch.setattr(agent_routes, "require_model", lambda select=None: FunctionModel(lambda m, i: final({"sentence": "Ok."})))
    body = {"rawTokens": ["ok"], "draft": "Ok."}
    for _ in range(agent_routes.refine_rate_limiter.per_minute):
        assert client.post("/api/agent/refine-sentence", json=body).status_code == 200
    blocked = client.post("/api/agent/refine-sentence", json=body)
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers
