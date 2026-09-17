"""The agents, run against scripted models so no provider is called.

pydantic_ai.models.ALLOW_MODEL_REQUESTS is switched off for the whole module: a test that reached Gemini
or Groq would fail instead of spending tokens.
"""

import json

import pytest
from pydantic_ai import models
from pydantic_ai.messages import ModelResponse, RetryPromptPart, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agents import assistant, cfg_compiler, sentence_refiner, telemetry_reporter
from agents.llm import AgentUnavailable, build_model, configured_providers, refine_model
from config import get_settings
from routers import agents as agent_routes

models.ALLOW_MODEL_REQUESTS = False


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    agent_routes.rate_limiter.clear()
    agent_routes.refine_rate_limiter.clear()
    yield
    agent_routes.rate_limiter.clear()
    agent_routes.refine_rate_limiter.clear()


def final(args: dict) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(tool_name="final_result", args=args)])


def tool_returns(messages, name: str) -> list[str]:
    return [
        str(part.content)
        for message in messages
        for part in message.parts
        if isinstance(part, ToolReturnPart) and part.tool_name == name
    ]


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
# cfg_compiler.py


def test_check_grammar_accepts_rules_hooked_into_the_base_grammar():
    report = cfg_compiler.check_grammar("WHQ_WHERE -> WH NP COP\nXCORE -> WHQ_WHERE")
    assert report.ok and report.productions == 2


@pytest.mark.parametrize(
    "rules, fragment",
    [
        ("WHQ_WHERE -> WH NP COP", "never reached from S"),
        ("XCORE -> WH NP 'verb'", "not a tag the lexer produces"),
        ("XCORE -> WH NOPE", "NOPE has no productions"),
        ("S -> NP VG", "do not redefine S"),
        ("WHQ_WHERE -> WH NP COP   # trailing comment", "fromstring() failed"),
        ("", "no rules"),
    ],
)
def test_check_grammar_reports_problems(rules, fragment):
    report = cfg_compiler.check_grammar(rules)
    assert not report.ok
    assert fragment in report.message


def test_check_transforms_requires_a_permutation():
    output = cfg_compiler.CFGCompilerOutput(
        grammar_rules=["WHQ_WHERE -> WH NP COP", "XCORE -> WHQ_WHERE"],
        ast_transform_map={"WHQ_WHERE": "WH COP NP", "XCORE": "WHQ_WHERE", "NOPE": "WH"},
        validation_status=False,
    )
    problems = cfg_compiler.check_transforms(output)
    assert problems == ["ast_transform_map key NOPE is not a left-hand side in grammar_rules"]
    output.ast_transform_map["WHQ_WHERE"] = "WH COP"
    assert any("not a permutation" in problem for problem in cfg_compiler.check_transforms(output))


def test_compile_loop_fixes_invalid_rules_before_saving(tmp_path):
    """The scripted model first writes an unreachable rule, gets the validator's message, and fixes it."""
    path = tmp_path / "user_custom.cfg"
    drafts = iter(
        [
            "WHQ_WHERE -> WH NP COP",
            "WHQ_WHERE -> WH NP COP\nXCORE -> WHQ_WHERE",
        ]
    )
    state = {"draft": ""}

    async def scripted(messages, info: AgentInfo) -> ModelResponse:
        for part in messages[-1].parts:
            if isinstance(part, ToolReturnPart) and part.tool_name == cfg_compiler.VALIDATE_TOOL and str(part.content).startswith("valid"):
                rules = state["draft"].splitlines()
                return final({"grammar_rules": rules, "ast_transform_map": {"WHQ_WHERE": "WH COP NP"}, "validation_status": True})
        state["draft"] = next(drafts)
        return ModelResponse(parts=[ToolCallPart(tool_name=cfg_compiler.VALIDATE_TOOL, args={"rules": state["draft"]})])

    result = cfg_compiler.compile_grammar(
        "Add custom reordering for questions starting with 'where'", model=FunctionModel(scripted), path=path
    )
    assert result.output.validation_status is True
    assert result.output.grammar_rules == ["WHQ_WHERE -> WH NP COP", "XCORE -> WHQ_WHERE"]
    assert result.validationRounds == 2
    assert result.saved and result.path == str(path)

    saved = path.read_text(encoding="utf-8")
    assert "# Add custom reordering for questions starting with 'where'" in saved
    assert "WHQ_WHERE -> WH NP COP\nXCORE -> WHQ_WHERE\n" in saved
    # The saved file is itself a valid grammar block on top of the base grammar.
    assert cfg_compiler.check_grammar(cfg_compiler.load_custom_grammar(path)).ok
    transforms = json.loads(cfg_compiler.transforms_path(path).read_text(encoding="utf-8"))
    assert transforms == {"WHQ_WHERE": "WH COP NP"}


def test_compile_rejects_a_final_answer_that_does_not_validate(tmp_path):
    """An answer whose rules fail is sent back as a retry; the model then fixes it."""
    answers = iter(
        [
            final({"grammar_rules": ["WHQ_WHERE -> WH NP COP"], "ast_transform_map": {}, "validation_status": True}),
            final({"grammar_rules": ["WHQ_WHERE -> WH NP COP", "XCORE -> WHQ_WHERE"], "ast_transform_map": {}, "validation_status": True}),
        ]
    )
    seen_retry = {"value": False}

    async def scripted(messages, info: AgentInfo) -> ModelResponse:
        if any(isinstance(part, RetryPromptPart) for part in messages[-1].parts):
            seen_retry["value"] = True
        return next(answers)

    result = cfg_compiler.compile_grammar("where questions", model=FunctionModel(scripted), path=tmp_path / "g.cfg", save=False)
    assert seen_retry["value"]
    assert result.validationRounds == 1
    assert not (tmp_path / "g.cfg").exists()


# ---------------------------------------------------------------------------
# telemetry_reporter.py


def sample_log(**overrides) -> telemetry_reporter.SessionLog:
    samples = []
    for index in range(60):
        t = index * 5_000  # a sample every 5 s for 5 minutes
        strain = 30 + index * 0.9  # rises to ~83 by the end
        samples.append(
            telemetry_reporter.StrainSample(
                timestamp=t, jitterPercent=0.6 + index * 0.02, shimmerDb=0.25 + index * 0.005, hnrDb=18 - index * 0.1, strainIndex=min(100, strain), pitchHz=118 + (index % 3)
            )
        )
    events = [telemetry_reporter.FeedbackEvent(timestamp=t, kind="block", value=600) for t in (20_000, 50_000, 80_000, 110_000)]
    events.append(telemetry_reporter.FeedbackEvent(timestamp=120_000, kind="daf", value=60))
    events.append(telemetry_reporter.FeedbackEvent(timestamp=200_000, kind="block", value=400))
    payload = {"samples": samples, "events": events, "dafDelayMs": 60, "fsfOctaveShift": 0}
    payload.update(overrides)
    return telemetry_reporter.SessionLog(**payload)


def test_metrics_are_computed_from_the_log():
    metrics = telemetry_reporter.compute_metrics(sample_log())
    assert metrics.duration_minutes == pytest.approx(295_000 / 60_000, abs=0.01)
    assert (metrics.blocks_before_feedback, metrics.blocks_with_feedback) == (4, 1)
    # 4 blocks in 2 min before DAF, 1 block in 2.92 min with it: rate fell from 2.0 to 0.34 per minute.
    assert metrics.reduction_index == pytest.approx(1 - (1 / (175_000 / 60_000)) / (4 / 2), abs=0.01)
    assert metrics.fatigue_alert is True
    assert metrics.recommended_daf_ms == 60  # DAF worked, keep it
    assert metrics.daf_activations == 1 and metrics.fsf_activations == 0
    assert metrics.strain_trend > 30 and metrics.jitter_trend > 0


def test_daf_recommendation_rules():
    # No feedback used and frequent blocks: suggest the default delay.
    log = sample_log(events=[telemetry_reporter.FeedbackEvent(timestamp=t, kind="block") for t in range(10_000, 295_000, 20_000)], dafDelayMs=0)
    assert telemetry_reporter.compute_metrics(log).recommended_daf_ms == telemetry_reporter.DAF_DEFAULT_MS
    # Feedback on but blocks did not fall: step the delay up.
    events = [telemetry_reporter.FeedbackEvent(timestamp=t, kind="block") for t in (20_000, 50_000, 140_000, 170_000, 200_000, 230_000)]
    events.append(telemetry_reporter.FeedbackEvent(timestamp=100_000, kind="daf", value=60))
    assert telemetry_reporter.compute_metrics(sample_log(events=events, dafDelayMs=60)).recommended_daf_ms == 85
    metrics = telemetry_reporter.compute_metrics(sample_log(events=events, dafDelayMs=50))
    assert metrics.reduction_index < telemetry_reporter.REDUCTION_KEEP_THRESHOLD
    assert metrics.recommended_daf_ms == 75
    # Calm session: no DAF needed.
    calm = telemetry_reporter.SessionLog(samples=sample_log().samples[:10], events=[], dafDelayMs=0)
    assert telemetry_reporter.compute_metrics(calm).recommended_daf_ms == 0


def test_generate_report_keeps_the_computed_numbers():
    """The model's numbers are ignored; only its paragraph is used."""

    async def scripted(messages, info: AgentInfo) -> ModelResponse:
        prompt = str(messages[0].parts[-1].content)
        assert "stuttering_reduction_index" in prompt and "vocal_fatigue_alert: true" in prompt
        return final(
            {
                "session_duration_minutes": 999,
                "stuttering_reduction_index": -0.5,
                "vocal_fatigue_alert": False,
                "slp_summary_paragraph": "Jitter rose across the session while pitch stayed steady.  Strain climbed into the fatigue range; DAF cut blocks.",
                "recommended_daf_delay_ms": 999,
            }
        )

    report = telemetry_reporter.generate_report(sample_log(), model=FunctionModel(scripted))
    metrics = telemetry_reporter.compute_metrics(sample_log())
    assert report.session_duration_minutes == metrics.duration_minutes
    assert report.stuttering_reduction_index == metrics.reduction_index
    assert report.vocal_fatigue_alert is True
    assert report.recommended_daf_delay_ms == 60
    assert report.slp_summary_paragraph == "Jitter rose across the session while pitch stayed steady. Strain climbed into the fatigue range; DAF cut blocks."


# ---------------------------------------------------------------------------
# assistant.py


def test_dsp_delay_tool_matches_the_capture_worklet():
    estimate = assistant.simulate_dsp_delay(48_000)
    assert estimate.antiAliasTaps == 159  # the same Hamming rule as captureProcessor.js
    assert estimate.captureQuantumMs == pytest.approx(128 / 48, abs=0.01)
    assert estimate.antiAliasGroupDelayMs == pytest.approx(79 / 48, abs=0.01)
    assert estimate.endToEndMs < 5 and estimate.worstCaseMs < 15 and estimate.withinBudget
    native = assistant.simulate_dsp_delay(16_000)
    assert native.antiAliasTaps == 1 and native.antiAliasGroupDelayMs == 0


def test_recommend_settings_table():
    assert assistant.recommend_settings("stuttering").model_dump(include={"dafDelayMs", "pitchShiftSemitones"}) == {"dafDelayMs": 60, "pitchShiftSemitones": -6}
    assert assistant.recommend_settings("dysarthria").dafDelayMs == 100
    assert assistant.recommend_settings("aphasia").dafDelayMs == 0


def test_chat_runs_tools_and_reports_them():
    async def scripted(messages, info: AgentInfo) -> ModelResponse:
        assert {tool.name for tool in info.function_tools} == {"simulate_dsp_delay", "recommend_settings"}
        returns = tool_returns(messages, "simulate_dsp_delay")
        if not returns:
            return ModelResponse(parts=[ToolCallPart(tool_name="simulate_dsp_delay", args={"sample_rate": 48000})])
        return ModelResponse(parts=[TextPart(content=f"At 48 kHz the worst case is under 15 ms: {returns[0][:40]}")])

    request = assistant.ChatRequest(
        messages=[
            assistant.ChatMessage(role="user", content="hi"),
            assistant.ChatMessage(role="assistant", content="Hello. How can I help?"),
            assistant.ChatMessage(role="user", content="How fast is the analysis at 48 kHz?"),
        ]
    )
    response = assistant.chat(request, model=FunctionModel(scripted))
    assert response.reply.startswith("At 48 kHz the worst case is under 15 ms")
    assert [call.name for call in response.toolCalls] == ["simulate_dsp_delay"]
    assert response.toolCalls[0].args == {"sample_rate": 48000}
    assert response.toolCalls[0].result["withinBudget"] is True


def test_chat_requires_a_user_turn_last():
    request = assistant.ChatRequest(messages=[assistant.ChatMessage(role="assistant", content="Hello")])
    with pytest.raises(ValueError):
        assistant.chat(request, model=FunctionModel(lambda messages, info: ModelResponse(parts=[TextPart(content="x")])))


# ---------------------------------------------------------------------------
# routers/agents.py


def test_status_and_503_without_a_provider(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GROQ_API_KEY", "")
    get_settings.cache_clear()
    from agents.llm import agent_model

    agent_model.cache_clear()
    try:
        status = client.get("/api/agent/status").json()
        assert status == {"available": False, "providers": [], "primary": None}
        response = client.post("/api/agent/chat", json={"messages": [{"role": "user", "content": "hello"}]})
        assert response.status_code == 503
        assert "GEMINI_API_KEY" in response.json()["detail"]
    finally:
        get_settings.cache_clear()
        agent_model.cache_clear()


def test_endpoints_use_the_agents(client, monkeypatch):
    async def scripted(messages, info: AgentInfo) -> ModelResponse:
        names = {tool.name for tool in info.output_tools}
        if "final_result" in names and any(tool.name == cfg_compiler.VALIDATE_TOOL for tool in info.function_tools):
            return final({"grammar_rules": ["WHQ_WHERE -> WH NP COP", "XCORE -> WHQ_WHERE"], "ast_transform_map": {}, "validation_status": True})
        if "final_result" in names:
            return final(
                {
                    "session_duration_minutes": 0,
                    "stuttering_reduction_index": 0,
                    "vocal_fatigue_alert": False,
                    "slp_summary_paragraph": "Pitch was steady and strain stayed low.",
                    "recommended_daf_delay_ms": 0,
                }
            )
        return ModelResponse(parts=[TextPart(content="All processing stays on your device.")])

    monkeypatch.setattr(agent_routes, "require_model", lambda: FunctionModel(scripted))

    chat = client.post("/api/agent/chat", json={"messages": [{"role": "user", "content": "Is my audio uploaded?"}]})
    assert chat.status_code == 200
    assert chat.json()["reply"] == "All processing stays on your device."
    assert chat.json()["toolCalls"] == []

    log = sample_log().model_dump(mode="json")
    report = client.post("/api/agent/generate-report", json=log)
    assert report.status_code == 200
    body = report.json()
    assert body["vocal_fatigue_alert"] is True and body["recommended_daf_delay_ms"] == 60
    assert body["slp_summary_paragraph"] == "Pitch was steady and strain stayed low."

    compiled = client.post("/api/agent/compile-grammar", json={"prompt": "reorder where questions", "save": False})
    assert compiled.status_code == 200
    assert compiled.json()["output"]["validation_status"] is True
    assert compiled.json()["saved"] is False


def test_agent_rate_limit(client, monkeypatch):
    monkeypatch.setattr(agent_routes, "require_model", lambda: FunctionModel(lambda m, i: ModelResponse(parts=[TextPart(content="ok")])))
    limit = agent_routes.rate_limiter.per_minute
    for _ in range(limit):
        assert client.post("/api/agent/chat", json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 200
    blocked = client.post("/api/agent/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_chat_rejects_bad_history(client, monkeypatch):
    monkeypatch.setattr(agent_routes, "require_model", lambda: FunctionModel(lambda m, i: ModelResponse(parts=[TextPart(content="ok")])))
    response = client.post("/api/agent/chat", json={"messages": [{"role": "assistant", "content": "hi"}]})
    assert response.status_code == 422
    assert response.json()["detail"] == "The last message must be from the user."


# ---------------------------------------------------------------------------
# sentence_refiner.py


def test_refiner_prompt_carries_the_words_the_rough_sentence_and_the_context():
    request = sentence_refiner.SentenceRefineRequest(
        rawTokens=["tevelision", "on"], draft="On tevelision.", profileMode="aphasia", context=["I am tired.", "I want to sit down."]
    )
    prompt = sentence_refiner.build_prompt(request)
    assert "Mode: aphasia" in prompt
    assert "<earlier>\n- I am tired.\n- I want to sit down.\n</earlier>" in prompt
    assert "<words>\ntevelision on\n</words>" in prompt
    assert "<rough>\nOn tevelision.\n</rough>" in prompt
    assert "(nothing yet)" in sentence_refiner.build_prompt(request.model_copy(update={"context": []}))


def test_refine_sentence_returns_the_models_sentence():
    seen: list[str] = []

    def scripted(messages, info: AgentInfo) -> ModelResponse:
        seen.append(str(messages[-1].parts[-1].content))
        return final({"sentence": "  Turn the   television on. "})

    request = sentence_refiner.SentenceRefineRequest(rawTokens=["tevelision", "on"], draft="On tevelision.", profileMode="aphasia")
    answer = sentence_refiner.refine_sentence(request, model=FunctionModel(scripted))
    assert answer.text == "Turn the television on."
    assert answer.modelName.startswith("function:")
    assert "tevelision on" in seen[0]


def test_refine_endpoint(client, monkeypatch):
    monkeypatch.setattr(agent_routes, "require_model", lambda select=None: FunctionModel(lambda m, i: final({"sentence": "I want to go to the store."})))
    body = {"rawTokens": "um i w-w-want to go the store".split(), "draft": "I want to go the store.", "context": ["Hi."]}
    response = client.post("/api/agent/refine-sentence", json=body)
    assert response.status_code == 200
    assert response.json()["text"] == "I want to go to the store."

    assert client.post("/api/agent/refine-sentence", json={**body, "profileMode": "fluency"}).status_code == 422
    assert client.post("/api/agent/refine-sentence", json={**body, "rawTokens": []}).status_code == 422
    too_long = [f"Sentence {n}." for n in range(sentence_refiner.MAX_CONTEXT_SENTENCES + 1)]
    assert client.post("/api/agent/refine-sentence", json={**body, "context": too_long}).status_code == 422


def test_refine_has_its_own_rate_limit(client, monkeypatch):
    monkeypatch.setattr(agent_routes, "require_model", lambda select=None: FunctionModel(lambda m, i: final({"sentence": "Ok."})))
    body = {"rawTokens": ["ok"], "draft": "Ok."}
    for _ in range(agent_routes.rate_limiter.per_minute + 1):
        assert client.post("/api/agent/refine-sentence", json=body).status_code == 200
    for _ in range(agent_routes.refine_rate_limiter.per_minute - agent_routes.rate_limiter.per_minute - 1):
        client.post("/api/agent/refine-sentence", json=body)
    assert client.post("/api/agent/refine-sentence", json=body).status_code == 429
