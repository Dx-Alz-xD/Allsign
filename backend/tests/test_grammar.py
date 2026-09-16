from typing import TYPE_CHECKING, NamedTuple

import pytest

import grammar_engine

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


class GrammarCase(NamedTuple):
    tokens: list[str]
    expected: str
    # Set when the grammar has no rule for the input yet; the case runs as a strict xfail.
    known_gap: str | None = None


CASES = [
    GrammarCase(["me", "water", "want"], "I want water."),
    GrammarCase(["um", "I", "I", "w-w-want", "water"], "I want water."),
    GrammarCase(["he", "want", "cookie"], "He wants cookie."),
    GrammarCase(["me", "school", "to", "go"], "I go to school."),
    GrammarCase(["water", "me", "want"], "I want water."),
    GrammarCase(["me", "hungry"], "I am hungry."),
    GrammarCase(["your", "name", "what"], "What is your name?"),
    GrammarCase(["mom", "where"], "Where is mom?"),
    GrammarCase(["you", "want", "what"], "What do you want?"),
    GrammarCase(["she", "no", "like", "it"], "She does not like it."),
    GrammarCase(["give", "me", "water", "please"], "Give me water please."),
    GrammarCase(["I", "going", "school", "to"], "I am going to school."),
    GrammarCase(["can", "I", "has", "water"], "Can I have water?"),
    GrammarCase(["ball", "dog", "chase"], "Dog chases ball."),
    GrammarCase(["I", "want", "to", "go", "home", "now"], "I want to go home now."),
    GrammarCase(["uh", "hmm"], ""),
    GrammarCase(["me", "want", "go", "bathroom"], "I want to go bathroom."),
    GrammarCase(["I", "sad", "because", "dog", "sick"], "I am sad because dog is sick."),
    GrammarCase(["is", "you", "hungry"], "Are you hungry?"),
    GrammarCase(["want", "water", "me"], "I want water."),
    GrammarCase(["I", "happy", "am"], "I am happy."),
    GrammarCase(["hungry", "me"], "I am hungry."),
    GrammarCase(["him", "I", "see"], "I see him."),
    GrammarCase(["give", "water", "me"], "Give me water."),
    GrammarCase(["where", "mom", "go"], "Where does mom go?"),
    GrammarCase(["I", "want", "a", "drink"], "I want a drink."),
    GrammarCase(["turn", "off", "light"], "Turn light off."),
    GrammarCase(["help", "me"], "Help me."),
    GrammarCase(["go", "I"], "I go."),
    GrammarCase(["want", "me", "water"], "I want water."),
    GrammarCase(["mom", "me", "help"], "Mom helps me."),
    GrammarCase(["I", "want", "tea", "and", "water"], "I want tea and water."),
    GrammarCase(["me", "and", "mom", "go", "park"], "I and mom go park."),
    GrammarCase(["I", "want", "you", "help", "me"], "I want you to help me."),
    GrammarCase(["do", "you", "want", "water"], "Do you want water?"),
    GrammarCase(["I", "don't", "want", "it"], "I do not want it."),
    GrammarCase(["he", "not", "eat", "food"], "He does not eat food."),
    GrammarCase(["he", "not", "ate", "food"], "He did not eat food."),
    GrammarCase(["later", "me", "food", "eat"], "Later I eat food."),
    GrammarCase(["who", "want", "water"], "Who wants water?"),
    GrammarCase(
        ["where", "my", "shoes", "are"],
        "Where are my shoes?",
        known_gap="no WHQ rule for wh-word + NP + trailing copula",
    ),
    GrammarCase(["where", "are", "my", "shoes"], "Where are my shoes?"),
    GrammarCase(["dog", "hungry"], "Dog is hungry."),
    GrammarCase(["hungry", "dog"], "Hungry dog."),
    GrammarCase(["water"], "Water."),
    GrammarCase(["I'm", "tired"], "I am tired."),
    GrammarCase(["gimme", "cookie"], "Give me cookie."),
    GrammarCase(["sooo", "hungryyy", "me"], "I am so hungry."),
    GrammarCase(["me", "not", "hungry"], "I am not hungry."),
    GrammarCase(["they", "is", "happy"], "They are happy."),
    GrammarCase(["I", "wants", "juice"], "I want juice."),
    GrammarCase(["Priya", "me", "call"], "Priya calls me."),
    GrammarCase(["me", "home", "at"], "I am at home."),
    GrammarCase(["wa", "want", "juice"], "Want juice."),
    GrammarCase(["I", "want", "I", "want", "water"], "I want water."),
    GrammarCase(["xyzzy", "blorp"], "Xyzzy blorp."),
    GrammarCase(["can", "you", "help", "me", "please"], "Can you help me please?"),
    GrammarCase(["me", "water", "no", "want"], "I do not want water."),
    GrammarCase([], ""),
]


def case_params() -> list:
    return [
        pytest.param(
            case,
            id=" ".join(case.tokens) or "<empty>",
            marks=[pytest.mark.xfail(reason=case.known_gap, strict=True)] if case.known_gap else [],
        )
        for case in CASES
    ]


@pytest.mark.parametrize("case", case_params())
def test_translation(case: GrammarCase) -> None:
    result = grammar_engine.translate(case.tokens)
    assert result.formatted_text == case.expected
    assert result.original_tokens == case.tokens
    assert "\n" not in result.parsed_tree and result.parsed_tree.startswith("(ROOT")


def test_translate_endpoint_returns_contract_fields(client: "TestClient") -> None:
    response = client.post(
        "/api/grammar/translate",
        json={"rawSpeechTokens": ["me", "water", "want"], "sourceLang": "en", "targetProfile": "clearvoice"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["formattedText"] == "I want water."
    assert body["originalTokens"] == ["me", "water", "want"]
    assert body["parsedTree"] == "(ROOT (S (NP (PRON I)) (VP (V want) (NP (N water)))))"
    assert body["executionLatencyMs"] >= 0


def test_translate_endpoint_rejects_non_json_numbers(client: "TestClient") -> None:
    response = client.post(
        "/api/grammar/translate", content='{"rawSpeechTokens": [NaN]}', headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["input"] == "nan"


def test_translate_endpoint_rejects_unsupported_language(client: "TestClient") -> None:
    response = client.post("/api/grammar/translate", json={"rawSpeechTokens": ["water"], "sourceLang": "hi"})
    assert response.status_code == 422
