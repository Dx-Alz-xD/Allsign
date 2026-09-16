"""Compiles a plain-text speech-correction request into NLTK CFG rules.

An authoring-time tool: a clinician or developer describes a correction ("add custom reordering for
questions starting with 'where'") and gets back productions in the grammar engine's own vocabulary. Every
candidate goes through nltk.CFG.fromstring() and a check against the base grammar before it is written to
grammars/user_custom.cfg; the model gets the error text back and fixes the rules until they pass.

The model never runs while someone is speaking. The saved file is plain CFG text, and loading it into
grammar_engine is a separate, deterministic step.
"""

import json
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

import nltk
from nltk.grammar import Nonterminal
from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.messages import ModelResponse, RetryPromptPart, ToolCallPart
from pydantic_ai.models import Model

from agents.llm import agent_model
from config import get_settings
from grammar_engine import GRAMMAR, GRAMMAR_RULES

BACKEND_DIR = Path(__file__).resolve().parent.parent
VALIDATE_TOOL = "validate_nltk_grammar"
MAX_RULES = 40
MAX_REQUEST_CHARS = 1000

# What the lexer produces, so the model writes terminals the engine can actually see.
TERMINAL_MEANINGS = {
    "v": "verb in base or past form (want, went, take)",
    "ving": "verb ending in -ing (going, eating)",
    "aux": "auxiliary: do, does, did, can, will, should, have, has, had",
    "cop": "copula: am, is, are, was, were",
    "neg": "not, n't, never",
    "pron_s": "subject pronoun: I, he, she, we, they",
    "pron_o": "object pronoun: me, him, us, them",
    "pron": "pronoun that is subject or object: you, it, this, that",
    "det": "determiner or number: the, a, my, your, some, two",
    "n": "noun (any unknown word is tagged n)",
    "adj": "adjective: hungry, cold, big",
    "deg": "degree word: very, too, so, really",
    "adv": "adverb: now, here, quickly, tomorrow",
    "p": "preposition: in, on, at, with, for, from",
    "to": "the word to",
    "wh": "question word: where, what, who, when, why, how",
    "conj": "and, but, or",
}

TERMINALS = sorted({symbol for production in GRAMMAR.productions() for symbol in production.rhs() if isinstance(symbol, str)})
BASE_NONTERMINALS = sorted({str(production.lhs()) for production in GRAMMAR.productions()})


class CFGCompilerOutput(BaseModel):
    grammar_rules: list[str] = Field(
        description='One production per entry in NLTK syntax, e.g. "WHQ_WHERE -> WH COP NP". Terminals are quoted tags.',
        min_length=1,
        max_length=MAX_RULES,
    )
    ast_transform_map: dict[str, str] = Field(
        description=(
            "For each new non-terminal whose words must be reordered, the order they are rebuilt in, as a "
            'space-separated permutation of its right-hand side, e.g. {"WHQ_WHERE": "WH COP NP"}.'
        ),
        default_factory=dict,
    )
    validation_status: bool = Field(description="True only after validate_nltk_grammar reported the rules valid.")


class CompiledGrammar(BaseModel):
    """What compile_grammar returns and POST /api/agent/compile-grammar answers."""

    request: str
    output: CFGCompilerOutput
    path: str
    validationRounds: int
    modelName: str
    saved: bool


@dataclass
class GrammarCheck:
    ok: bool
    message: str
    productions: int = 0
    problems: list[str] = field(default_factory=list)


def _format_problems(problems: list[str]) -> str:
    return "Invalid:\n- " + "\n- ".join(problems)


def _reachable(grammar: nltk.CFG) -> set[Nonterminal]:
    seen = {grammar.start()}
    queue = deque(seen)
    while queue:
        current = queue.popleft()
        for production in grammar.productions(lhs=current):
            for symbol in production.rhs():
                if isinstance(symbol, Nonterminal) and symbol not in seen:
                    seen.add(symbol)
                    queue.append(symbol)
    return seen


def check_grammar(rules: str) -> GrammarCheck:
    """Syntax check with nltk.CFG.fromstring(), then a check that the rules fit the engine's grammar.

    A rule may extend a base non-terminal (WHQ -> ...) or define a new one, but every terminal must be a
    tag the lexer produces, every non-terminal on a right-hand side must have productions, and a new
    non-terminal must be reachable from S, or the parser would never use it.
    """
    text = rules.strip()
    if not text:
        return GrammarCheck(False, "Invalid: no rules were given.")
    try:
        custom = nltk.CFG.fromstring(text)
    except ValueError as error:
        return GrammarCheck(False, f"Invalid: nltk.CFG.fromstring() failed: {error}")
    if len(custom.productions()) > MAX_RULES:
        return GrammarCheck(False, f"Invalid: at most {MAX_RULES} productions per request.")

    combined = nltk.CFG.fromstring(GRAMMAR_RULES + "\n" + text)
    defined = {production.lhs() for production in combined.productions()}
    reachable = _reachable(combined)
    problems: list[str] = []
    for production in custom.productions():
        for symbol in production.rhs():
            if isinstance(symbol, str):
                if symbol not in TERMINALS:
                    problems.append(f"'{symbol}' is not a tag the lexer produces; use one of: {', '.join(TERMINALS)}")
            elif symbol not in defined:
                problems.append(f"{symbol} has no productions; define it or use a base non-terminal")
        if production.lhs() not in reachable:
            problems.append(
                f"{production.lhs()} is never reached from S; add it to a base rule, e.g. XCORE -> {production.lhs()}"
            )
        if production.lhs() == Nonterminal("S"):
            problems.append("do not redefine S; extend XCORE, WHQ, COMP or another base non-terminal instead")
    problems = list(dict.fromkeys(problems))
    if problems:
        return GrammarCheck(False, _format_problems(problems), len(custom.productions()), problems)
    return GrammarCheck(True, f"valid: {len(custom.productions())} production(s)", len(custom.productions()))


def check_transforms(output: CFGCompilerOutput) -> list[str]:
    """Each transform must name a rule from the output and permute that rule's right-hand side."""
    problems: list[str] = []
    rhs_by_lhs: dict[str, list[list[str]]] = {}
    for production in nltk.CFG.fromstring("\n".join(output.grammar_rules)).productions():
        rhs_by_lhs.setdefault(str(production.lhs()), []).append([str(symbol) for symbol in production.rhs()])
    for lhs, order in output.ast_transform_map.items():
        if lhs not in rhs_by_lhs:
            problems.append(f"ast_transform_map key {lhs} is not a left-hand side in grammar_rules")
            continue
        wanted = order.split()
        if not any(sorted(wanted) == sorted(rhs) for rhs in rhs_by_lhs[lhs]):
            problems.append(f"ast_transform_map[{lhs}] = {order!r} is not a permutation of a right-hand side of {lhs}")
    return problems


INSTRUCTIONS = f"""You convert a plain-text speech-correction request into NLTK context-free grammar rules for a
deterministic grammar engine. You write rules only; no prose.

The engine tags each word and parses the tag sequence. Terminals are these quoted tags:
{chr(10).join(f"  '{tag}': {TERMINAL_MEANINGS.get(tag, '')}" for tag in TERMINALS)}

Base non-terminals you may extend or reuse on a right-hand side:
  {', '.join(BASE_NONTERMINALS)}
Clause patterns hang off XCORE (statements: SVO SOV OSV ...; questions: YNQ WHQ; copular: COPULA ZERO_COP).
Phrases: NP (noun phrase), VG (verb group), COMP (complements), PP, ADJP, ADVP, PRED, WH, COP, NEG.

Rules:
- One production per line, NLTK syntax: LHS -> SYMBOL SYMBOL | SYMBOL. Quote terminals: 'wh'.
- A new non-terminal must be hooked into a base rule (for example XCORE -> WHQ_WHERE) or it is unreachable.
- Never redefine S. Keep the rule set minimal: only what the request needs.
- For each new pattern whose words must be reordered, put the rebuilt order in ast_transform_map as a
  permutation of that rule's right-hand side.
- Always call {VALIDATE_TOOL} with the complete rule block before answering. If it reports problems, fix
  the rules and call it again. Set validation_status to true only when it reported the rules valid.

Example request: "questions starting with where, said as 'where my shoes are', become 'where are my shoes'"
Example answer:
  grammar_rules: ["WHQ_WHERE -> WH NP COP", "XCORE -> WHQ_WHERE"]
  ast_transform_map: {{"WHQ_WHERE": "WH COP NP"}}
  validation_status: true
"""

compiler = Agent(
    output_type=CFGCompilerOutput,
    instructions=INSTRUCTIONS,
    retries=3,
    name="cfg_compiler",
)


@compiler.tool_plain
def validate_nltk_grammar(rules: str) -> str:
    """Parses CFG rules with nltk.CFG.fromstring() and checks them against the engine's grammar.

    Returns "valid: N production(s)" or a list of problems to fix. Pass the complete rule block, one
    production per line.
    """
    return check_grammar(rules).message


@compiler.output_validator
def _only_valid_rules(output: CFGCompilerOutput) -> CFGCompilerOutput:
    report = check_grammar("\n".join(output.grammar_rules))
    if not report.ok:
        raise ModelRetry(f"grammar_rules did not validate. {report.message}\nFix the rules and answer again.")
    problems = check_transforms(output)
    if problems:
        raise ModelRetry(_format_problems(problems) + "\nFix ast_transform_map and answer again.")
    output.validation_status = True
    return output


def custom_grammar_path() -> Path:
    path = Path(get_settings().CUSTOM_GRAMMAR_PATH)
    return path if path.is_absolute() else BACKEND_DIR / path


def transforms_path(grammar_path: Path) -> Path:
    return grammar_path.with_suffix(".transforms.json")


def save_rules(output: CFGCompilerOutput, request: str, path: Path) -> None:
    """Appends the block to the .cfg (full-line comments only: NLTK rejects trailing ones) and merges transforms."""
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    header = "# " + " ".join(request.split())
    block = "\n".join([f"# {stamp}", header, *output.grammar_rules, ""]) + "\n"
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        if path.stat().st_size == 0:
            handle.write("# Custom rules compiled from plain-text requests. Loaded by grammar_engine only on request.\n\n")
        handle.write(block)

    sidecar = transforms_path(path)
    transforms: dict[str, str] = {}
    if sidecar.exists():
        transforms = json.loads(sidecar.read_text(encoding="utf-8"))
    transforms.update(output.ast_transform_map)
    sidecar.write_text(json.dumps(transforms, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_custom_grammar(path: Path | None = None) -> str:
    """The saved rule text, or an empty string. Comments are kept; nltk.CFG.fromstring() accepts them."""
    target = path or custom_grammar_path()
    return target.read_text(encoding="utf-8") if target.exists() else ""


def _validation_rounds(messages) -> int:
    rounds = 0
    for message in messages:
        if isinstance(message, ModelResponse):
            rounds += sum(1 for part in message.parts if isinstance(part, ToolCallPart) and part.tool_name == VALIDATE_TOOL)
        else:
            rounds += sum(1 for part in message.parts if isinstance(part, RetryPromptPart))
    return rounds


def compile_grammar(request: str, *, model: Model | None = None, path: Path | None = None, save: bool = True) -> CompiledGrammar:
    """Runs the generate -> validate -> fix loop and, when the rules pass, appends them to the grammar file."""
    text = " ".join(request.split())[:MAX_REQUEST_CHARS]
    result = compiler.run_sync(text, model=model or agent_model())
    output = result.output
    target = path or custom_grammar_path()
    if save:
        save_rules(output, text, target)
    return CompiledGrammar(
        request=text,
        output=output,
        path=str(target),
        validationRounds=_validation_rounds(result.all_messages()),
        modelName=result.response.model_name or "unknown",
        saved=save,
    )
