"""Deterministic AST grammar transducer.

Pipeline: normalize raw speech tokens (fillers, stutters, repeats, contractions) ->
tag each word from a closed lexicon -> chart-parse the tag sequence with a formal
CFG -> rank candidate trees with fixed rules -> rebuild the winner as a canonical
English (SVO) syntax tree -> linearize to text. No model calls anywhere.
"""

import logging
import re
import sys
import threading
import time
from collections import OrderedDict
from contextvars import ContextVar
from dataclasses import dataclass
from itertools import count, islice
from typing import NamedTuple

import nltk
from fastapi import APIRouter, HTTPException, Response
from nltk import Tree
from nltk.parse.earleychart import IncrementalChart, IncrementalLeftCornerChartParser

from schemas import GrammarRequestSchema, GrammarResponseSchema

LATENCY_BUDGET_MS = 10.0
# Parse work is bounded in chart edges (~10-12us each on a laptop), not wall-clock time, so the same
# input always gets the same output. A clause group that cannot be parsed within the budget, or is longer
# than MAX_GROUP_TOKENS, is returned cleaned but in its original order as an UNPARSED node.
MAX_CHART_EDGES = 400
MAX_GROUP_TOKENS = 16
MAX_CANDIDATE_PARSES = 64
# The chart depends only on the word-class sequence, so its candidate trees are cached per sequence and
# re-filled with each request's words ("I want water" and "I want tea" share one forest). Ranking still
# reads the real words, so the output is exactly what an uncached parse gives.
PARSE_CACHE_SIZE = 512
UNPARSED_HEADER = "X-Grammar-Unparsed-Groups"

log = logging.getLogger("grammar_engine")

# ---------------------------------------------------------------------------
# Formal grammar. Terminals are word-class tags produced by the lexer, so the
# grammar stays small and compiles once. Each clause pattern (SVO, SOV, OSV, ...)
# is its own non-terminal, which is what lets the transducer reorder it. A bare
# FRAG is only allowed as a whole utterance (CL), never inside a coordination
# (XCL); otherwise every "and" doubles the parse forest. A wh-question in statement order
# ("where my shoes are") is a WHQ and gets inverted; the same words inside a complement
# ("I know where my shoes are") are an indirect question (WHCL) and keep statement order. Word classes appear as
# terminals directly inside phrase rules: single-word wrapper rules cost chart edges.
# ---------------------------------------------------------------------------
GRAMMAR_RULES = """
S -> CL | XCL CONJ XS
XS -> XCL | XCL CONJ XS
CL -> XCL | FRAG | ADVP FRAG | FRAG ADVP
XCL -> XCORE | ADVP XCORE | XCORE ADVP | ADVP XCORE ADVP
XCORE -> SVO | SOV | OSV | OVS | VSO | VOS | SV | VS | VO | V_ONLY
XCORE -> COPULA | COPULA_FINAL | ZERO_COP | ZERO_COP_INV | YNQ | WHQ

SVO -> NP VG COMP
SOV -> NP COMP VG
OSV -> COMP NP VG
OVS -> COMP VG NP
VSO -> VG NPRO COMP
VOS -> VG COMP NPRO
SV -> NP VG
VS -> VG NPS
VO -> VG COMP
V_ONLY -> VG

COPULA -> NP COP PRED | NP COP NEG PRED
COPULA_FINAL -> NP PRED COP | NP PRED COP NEG
ZERO_COP -> NP ZPRED | NP NEG ZPRED
ZERO_COP_INV -> ZPRED NPRO

YNQ -> QAUX NP VG | QAUX NP VG COMP | COP NP PRED
WHQ -> WH QAUX NP VG | WH QAUX NP VG COMP | WH COP PRED
WHQ -> WH NP | NP WH
WHQ -> WH NP COP | WH NP COP PRED | WH NP COP NEG PRED
WHQ -> WH NP VG | WH NP VG COMP | NP VG WH | NP VG COMP WH
WHQ -> WH VG | WH VG COMP

FRAG -> NP | PP | ADJP

VG -> VERB | AUXL VERB | AUXL NEG VERB | NEG VERB | VERB NEG
AUXL -> 'aux' | 'cop'
QAUX -> 'aux' | 'cop'
VERB -> 'v' | 'ving'

COMP -> NP | NP NP | NP PPS | PPS | INF | NP INF | WHCL | NP WHCL
PPS -> PP | PP PPS
PP -> PREP NP | NP PREP
PREP -> 'p' | 'to'
INF -> TO VERB | TO VERB COMP | VERB | VERB COMP
WHCL -> WH NP VG | WH NP VG COMP | WH VG | WH VG COMP
WHCL -> WH NP COP | WH NP COP PRED | WH NP COP NEG PRED

PRED -> ADJP | PP | NP
ZPRED -> ADJP | PP
ADJP -> 'adj' | 'deg' 'adj' | 'adj' 'deg'
ADVP -> 'adv' | 'adv' ADVP

NP -> NPRO | NNOM | NPRO CONJ NP | NNOM CONJ NP
NPS -> 'pron_s'
NPRO -> 'pron_s' | 'pron_o' | 'pron'
NNOM -> NOM | 'det' NOM
NOM -> 'n' | ADJP NOM | 'n' NOM

COP -> 'cop'
NEG -> 'neg'
TO -> 'to'
WH -> 'wh'
CONJ -> 'conj'
"""

GRAMMAR = nltk.CFG.fromstring(GRAMMAR_RULES)

_edge_budget: ContextVar[int] = ContextVar("edge_budget", default=MAX_CHART_EDGES)


class _ChartBudgetExceeded(Exception):
    pass


class _BudgetedChart(IncrementalChart):
    def insert(self, edge, *child_pointer_lists):
        if self.num_edges() >= _edge_budget.get():
            raise _ChartBudgetExceeded
        return super().insert(edge, *child_pointer_lists)


# Left-corner filtering builds roughly half the edges of the default bottom-up strategy on this grammar.
PARSER = IncrementalLeftCornerChartParser(GRAMMAR, chart_class=_BudgetedChart)

# Lower is preferred: how far each clause pattern sits from canonical English order.
PATTERN_PENALTY = {
    "SVO": 0, "SV": 0, "VO": 0, "V_ONLY": 0, "COPULA": 0, "YNQ": 0, "WHQ": 0, "FRAG": 0,
    "SOV": 1, "COPULA_FINAL": 1, "ZERO_COP": 1,
    "OSV": 2, "VSO": 2, "VS": 2, "ZERO_COP_INV": 2,
    "OVS": 3, "VOS": 3,
}
COPULAR = frozenset({"COPULA", "COPULA_FINAL", "ZERO_COP", "ZERO_COP_INV"})
NP_LABELS = frozenset({"NP", "NPRO", "NPS"})
CLAUSE_LABELS = frozenset({"CL", "XCL"})
# A conjunction-delimited segment containing one of these can stand as its own clause.
VERBAL_TAGS = frozenset({"v", "ving", "aux", "cop", "wh"})
COMPOUND_NOUN_PENALTY = 3
POSTPOSITION_PENALTY = 1
BARE_INFINITIVE_PENALTY = 1

# ---------------------------------------------------------------------------
# Lexicon
# ---------------------------------------------------------------------------
LEXICON = {
    **dict.fromkeys(("i", "he", "she", "we", "they"), "pron_s"),
    **dict.fromkeys(("me", "him", "us", "them"), "pron_o"),
    **dict.fromkeys(("you", "it", "mine", "yours", "these", "those"), "pron"),
    **dict.fromkeys((
        "the", "a", "an", "my", "your", "his", "its", "our", "their", "some", "any", "every", "each",
        "much", "many", "more", "all", "another", "both", "several",
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "hundred",
    ), "det"),
    **dict.fromkeys((
        "big", "small", "little", "hot", "cold", "warm", "happy", "sad", "angry", "mad", "scared",
        "afraid", "hungry", "thirsty", "tired", "sleepy", "sick", "good", "bad", "nice", "new", "old",
        "clean", "dirty", "full", "empty", "wet", "dry", "loud", "quiet", "fast", "slow", "red", "blue",
        "green", "yellow", "black", "white", "pink", "purple", "brown", "ready", "done", "okay", "ok",
        "fine", "sore", "bored", "excited", "sweet", "yummy", "broken", "better", "worse", "best",
        "favorite", "same", "different", "easy", "hard", "busy", "late", "early", "alone", "sorry",
        "cool", "funny", "pretty", "beautiful", "great", "lonely", "nervous", "worried", "upset",
        "comfortable", "uncomfortable", "sure", "right", "wrong",
    ), "adj"),
    **dict.fromkeys(("very", "really", "so", "quite", "super", "extra"), "deg"),
    **dict.fromkeys((
        "now", "today", "tonight", "tomorrow", "yesterday", "here", "there", "again", "later", "soon",
        "please", "too", "also", "always", "sometimes", "already", "still", "first", "then", "away",
        "back", "up", "down", "out", "off", "together", "maybe", "just", "outside", "inside",
    ), "adv"),
    **dict.fromkeys(("not", "never"), "neg"),
    **dict.fromkeys((
        "can", "could", "will", "would", "shall", "should", "must", "may", "might", "do", "does", "did",
    ), "aux"),
    **dict.fromkeys(("am", "is", "are", "was", "were", "be"), "cop"),
    **dict.fromkeys((
        "in", "on", "at", "with", "for", "from", "of", "under", "over", "into", "onto", "by", "about",
        "near", "behind", "after", "before",
    ), "p"),
    "to": "to",
    **dict.fromkeys(("what", "where", "when", "who", "why", "how", "which", "whose"), "wh"),
    **dict.fromkeys(("and", "or", "but", "because"), "conj"),
    **dict.fromkeys((
        "something", "anything", "nothing", "everything", "someone", "everyone", "somebody", "nobody",
        "morning", "evening", "ceiling", "building", "pudding", "wedding", "clothing",
    ), "n"),
}
# Words whose tag depends on the next word; resolved in _lex.
AMBIGUOUS_WORDS = frozenset({"her", "this", "that", "no", "do", "does", "did"})

ANIMATE_NOUNS = frozenset({
    "mom", "mum", "mother", "mommy", "mama", "dad", "father", "daddy", "papa", "brother", "sister",
    "baby", "boy", "girl", "man", "woman", "men", "women", "friend", "teacher", "doctor", "nurse",
    "dog", "cat", "bird", "puppy", "kitty", "grandma", "grandpa", "grandmother", "grandfather",
    "family", "people", "person", "kid", "kids", "child", "children", "son", "daughter", "uncle",
    "aunt", "therapist", "caregiver", "police", "driver", "someone", "everyone", "somebody", "nobody",
})
PLURAL_NOUNS = frozenset({"people", "children", "men", "women", "feet", "teeth", "mice", "kids"})
PLURAL_DETERMINERS = frozenset({
    "these", "those", "many", "all", "both", "several",
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "hundred",
})

FILLERS = frozenset({"um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "eh", "hm", "hmm", "mm", "mhm"})

CONTRACTIONS = {
    "don't": ("do", "not"), "dont": ("do", "not"),
    "doesn't": ("does", "not"), "doesnt": ("does", "not"),
    "didn't": ("did", "not"), "didnt": ("did", "not"),
    "can't": ("can", "not"), "cant": ("can", "not"), "cannot": ("can", "not"),
    "won't": ("will", "not"), "wont": ("will", "not"),
    "isn't": ("is", "not"), "isnt": ("is", "not"),
    "aren't": ("are", "not"), "arent": ("are", "not"),
    "wasn't": ("was", "not"), "wasnt": ("was", "not"),
    "weren't": ("were", "not"),
    "i'm": ("i", "am"), "im": ("i", "am"),
    "you're": ("you", "are"), "we're": ("we", "are"), "they're": ("they", "are"),
    "he's": ("he", "is"), "she's": ("she", "is"), "it's": ("it", "is"), "that's": ("that", "is"),
    "what's": ("what", "is"), "where's": ("where", "is"), "who's": ("who", "is"),
    "i'll": ("i", "will"), "you'll": ("you", "will"), "we'll": ("we", "will"),
    "let's": ("let", "us"),
    "wanna": ("want", "to"), "gonna": ("going", "to"), "gotta": ("have", "to"),
    "gimme": ("give", "me"), "lemme": ("let", "me"),
}

NOMINATIVE = {"me": "i", "him": "he", "her": "she", "us": "we", "them": "they"}
ACCUSATIVE = {nominative: accusative for accusative, nominative in NOMINATIVE.items()}
PRONOUN_TAGS = frozenset({"pron_s", "pron_o", "pron"})
PAST_COPULAS = frozenset({"was", "were"})

# base: (third person singular, past)
IRREGULAR_VERBS = {
    "have": ("has", "had"), "do": ("does", "did"), "go": ("goes", "went"), "eat": ("eats", "ate"),
    "drink": ("drinks", "drank"), "see": ("sees", "saw"), "get": ("gets", "got"),
    "give": ("gives", "gave"), "take": ("takes", "took"), "make": ("makes", "made"),
    "come": ("comes", "came"), "know": ("knows", "knew"), "feel": ("feels", "felt"),
    "find": ("finds", "found"), "bring": ("brings", "brought"), "buy": ("buys", "bought"),
    "think": ("thinks", "thought"), "tell": ("tells", "told"), "say": ("says", "said"),
    "sleep": ("sleeps", "slept"), "read": ("reads", "read"), "write": ("writes", "wrote"),
    "run": ("runs", "ran"), "sit": ("sits", "sat"), "speak": ("speaks", "spoke"),
    "hear": ("hears", "heard"), "hurt": ("hurts", "hurt"), "put": ("puts", "put"),
    "cut": ("cuts", "cut"), "let": ("lets", "let"), "leave": ("leaves", "left"),
    "meet": ("meets", "met"), "pay": ("pays", "paid"), "send": ("sends", "sent"),
    "wear": ("wears", "wore"), "win": ("wins", "won"), "lose": ("loses", "lost"),
    "catch": ("catches", "caught"), "teach": ("teaches", "taught"),
    "understand": ("understands", "understood"), "forget": ("forgets", "forgot"),
    "swim": ("swims", "swam"), "sing": ("sings", "sang"), "draw": ("draws", "drew"),
    "throw": ("throws", "threw"), "fall": ("falls", "fell"), "hold": ("holds", "held"),
    "keep": ("keeps", "kept"), "begin": ("begins", "began"), "break": ("breaks", "broke"),
    "choose": ("chooses", "chose"), "drive": ("drives", "drove"), "fly": ("flies", "flew"),
    "grow": ("grows", "grew"), "ride": ("rides", "rode"), "stand": ("stands", "stood"),
    "wake": ("wakes", "woke"), "become": ("becomes", "became"), "sell": ("sells", "sold"),
}
REGULAR_VERBS = (
    "want", "need", "like", "love", "hate", "help", "play", "watch", "call", "open", "close", "stop",
    "start", "walk", "talk", "look", "cook", "clean", "wash", "use", "finish", "miss", "move", "wait",
    "work", "listen", "live", "turn", "try", "cry", "carry", "study", "hug", "kiss", "touch", "push",
    "pull", "jump", "dance", "change", "ask", "answer", "pick", "share", "learn", "visit", "rest",
    "return", "fix", "happen", "laugh", "smile", "point", "taste", "smell", "hope", "enjoy", "prefer",
    "stay", "brush", "dress", "fill", "pour", "order", "count", "climb", "chase", "show", "pass",
    "hand", "thank", "remember", "plan", "decide", "agree", "refuse", "promise", "offer", "bathe",
    "shop", "drop", "clap", "hop", "jog", "grab", "rub", "nod", "beg", "tap", "chat", "skip",
)
# Short verbs that double their final consonant before -ed / -ing.
DOUBLED_FINAL = frozenset({
    "stop", "hug", "drop", "shop", "skip", "plan", "jog", "clap", "hop", "chat", "grab", "rub",
    "nod", "beg", "tap", "swim", "run", "sit", "get", "put", "cut", "let", "begin", "win", "forget",
})
DITRANSITIVE = frozenset({
    "give", "tell", "show", "bring", "send", "buy", "make", "get", "pass", "hand", "read", "teach",
    "pay", "throw", "cook", "pour", "sell", "write", "offer",
})
TO_INFINITIVE_VERBS = frozenset({
    "want", "need", "like", "love", "hate", "try", "start", "begin", "forget", "remember", "learn",
    "hope", "plan", "prefer", "have", "ask", "decide", "wait", "promise", "agree", "choose", "refuse",
})
BARE_INFINITIVE_VERBS = frozenset({"let", "make", "help", "watch", "see", "hear", "feel", "go", "come"})
NOUN_VERB_HOMOGRAPHS = frozenset({
    "drink", "watch", "help", "play", "call", "walk", "work", "cook", "kiss", "hug", "wash", "rest",
    "order", "change", "answer", "point", "smell", "taste", "dance", "dress", "turn", "use", "start",
    "stop", "look", "talk", "wait", "drive", "ride", "swim", "run", "sleep", "fall", "break", "cut",
    "show", "visit", "touch", "push", "pull", "jump", "climb", "love", "hope", "brush", "cry", "laugh",
    "smile", "catch", "throw", "plan", "shop", "drop", "hand", "count",
})


def _third_person(base: str) -> str:
    if base.endswith(("s", "x", "z", "ch", "sh", "o")):
        return base + "es"
    if base.endswith("y") and base[-2] not in "aeiou":
        return base[:-1] + "ies"
    return base + "s"


def _past(base: str) -> str:
    if base.endswith("e"):
        return base + "d"
    if base.endswith("y") and base[-2] not in "aeiou":
        return base[:-1] + "ied"
    if base in DOUBLED_FINAL:
        return base + base[-1] + "ed"
    return base + "ed"


def _present_participle(base: str) -> str:
    if base.endswith("ie"):
        return base[:-2] + "ying"
    if base.endswith("e") and not base.endswith(("ee", "ye", "oe")):
        return base[:-1] + "ing"
    if base in DOUBLED_FINAL:
        return base + base[-1] + "ing"
    return base + "ing"


def _build_verb_tables() -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    inflections = {base: (_third_person(base), _past(base)) for base in REGULAR_VERBS}
    inflections.update(IRREGULAR_VERBS)
    third_person = {base: third for base, (third, _) in inflections.items()}
    # Bases go in first so forms like "read"/"put" stay base-form.
    forms = {base: (base, "base") for base in inflections}
    for base, (third, past) in inflections.items():
        forms.setdefault(third, (base, "3sg"))
        forms.setdefault(past, (base, "past"))
        forms.setdefault(_present_participle(base), (base, "ing"))
    return third_person, forms


THIRD_PERSON, VERB_FORMS = _build_verb_tables()
KNOWN_WORDS = frozenset(LEXICON) | frozenset(VERB_FORMS) | AMBIGUOUS_WORDS

# ---------------------------------------------------------------------------
# Normalization and lexing
# ---------------------------------------------------------------------------
_EDGE_PUNCT = re.compile(r"^\W+|\W+$")
_ELONGATION = re.compile(r"(\w)\1{2,}")


class Word(NamedTuple):
    word: str
    original: str


class Token(str):
    """A lexed word whose string value is its word-class tag.

    The chart parser matches terminals by string equality, so Tokens can be parsed directly and
    come back as tree leaves carrying the word, with no copying or re-attaching per candidate.
    """

    def __new__(cls, tag: str, word: str, surface: str, lemma: str | None = None, vform: str | None = None):
        token = super().__new__(cls, tag)
        token.tag = tag
        token.word = word
        token.surface = surface
        token.lemma = lemma
        token.vform = vform
        return token


def _collapse_elongation(word: str) -> str:
    if not _ELONGATION.search(word):
        return word
    single = _ELONGATION.sub(r"\1", word)
    double = _ELONGATION.sub(r"\1\1", word)
    if double.lower() in KNOWN_WORDS and single.lower() not in KNOWN_WORDS:
        return double
    return single


def _collapse_stutter(word: str) -> str:
    """w-w-want -> want; real hyphenated words (ice-cream) are kept."""
    parts = [part for part in word.split("-") if part]
    if len(parts) > 1 and all(parts[-1].lower().startswith(part.lower()) for part in parts[:-1]):
        return parts[-1]
    return word


def _normalize(raw_tokens: list[str]) -> list[Word]:
    words: list[Word] = []
    for raw in raw_tokens:
        for piece in raw.replace("’", "'").split():
            original = _collapse_elongation(_collapse_stutter(_EDGE_PUNCT.sub("", piece)))
            word = original.lower()
            if not word or word in FILLERS:
                continue
            if word in CONTRACTIONS:
                words.extend(Word(part, part) for part in CONTRACTIONS[word])
            else:
                words.append(Word(word, original))

    # Part-word repetition across tokens: "wa want" -> "want".
    words = [
        token for i, token in enumerate(words)
        if not (
            i + 1 < len(words)
            and token.word not in KNOWN_WORDS
            and words[i + 1].word != token.word
            and words[i + 1].word.startswith(token.word)
        )
    ]

    # Whole-word and phrase repetition: "I I want", "I want I want water".
    for size in (3, 2, 1):
        kept: list[Word] = []
        for token in words:
            kept.append(token)
            if len(kept) >= 2 * size and all(
                a.word == b.word for a, b in zip(kept[-size:], kept[-2 * size:-size])
            ):
                del kept[-size:]
        words = kept
    return words


def _base_tag(word: str) -> str:
    if word in LEXICON:
        return LEXICON[word]
    if word in VERB_FORMS:
        return "ving" if VERB_FORMS[word][1] == "ing" else "v"
    if word.isdigit():
        return "det"
    if len(word) > 5 and word.endswith("ing"):
        return "ving"
    if len(word) > 4 and word.endswith("ed") and not word.endswith("eed"):
        return "v"
    if len(word) > 4 and word.endswith("ly"):
        return "adv"
    return "n"


def _lex(tokens: list[Word]) -> list[Token]:
    tags = [_base_tag(token.word) for token in tokens]

    # Right-to-left so each ambiguous word sees its already-resolved right neighbour.
    for i in range(len(tokens) - 1, -1, -1):
        word = tokens[i].word
        if word not in AMBIGUOUS_WORDS:
            continue
        nxt = tags[i + 1] if i + 1 < len(tags) else None
        prev = tags[i - 1] if i > 0 else None
        if word == "her":
            tags[i] = "det" if nxt in ("n", "adj", "deg") else "pron_o"
        elif word in ("this", "that"):
            tags[i] = "det" if nxt in ("n", "adj", "deg") else "pron"
        elif word == "no":
            tags[i] = "neg" if nxt in ("v", "ving", "aux", "cop") else "det"
        elif nxt in ("neg", "v", "ving") or (
            prev in (None, "wh") and nxt in ("pron_s", "pron_o", "pron", "det", "n")
        ):
            tags[i] = "aux"
        else:
            tags[i] = "v"

    # A noun/verb homograph after a determiner or adjective is a noun: "a drink".
    for i in range(1, len(tokens)):
        if tags[i] == "v" and tokens[i].word in NOUN_VERB_HOMOGRAPHS and tags[i - 1] in ("det", "adj"):
            tags[i] = "n"

    lexed = []
    for (word, original), tag in zip(tokens, tags):
        lemma = vform = None
        if tag in ("v", "ving"):
            lemma, vform = VERB_FORMS.get(word, (None, "ing" if tag == "ving" else "past"))
        if word == "i":
            surface = "I"
        elif tag == "n" and original[:1].isupper():
            surface = original
        else:
            surface = word
        lexed.append(Token(tag, word, surface, lemma, vform))
    return lexed


# ---------------------------------------------------------------------------
# Parsing and ranking
# ---------------------------------------------------------------------------
def _child(node: Tree, labels: frozenset[str] | set[str]) -> Tree | None:
    return next((kid for kid in node if isinstance(kid, Tree) and kid.label() in labels), None)


def _head_token(node: Tree | None) -> Token | None:
    return node.leaves()[0] if node is not None else None


def _main_verb(vg: Tree | None) -> Token | None:
    return _head_token(_child(vg, {"VERB"})) if vg is not None else None


def _infinitive_marker(governor: Token | None, after_object: bool) -> str | None:
    """'to', '' for a bare infinitive, or None when the governor can't take a bare infinitive."""
    if governor is None:
        return None
    if governor.word == "going":
        return "to"
    if governor.lemma in BARE_INFINITIVE_VERBS and (after_object or governor.lemma in ("go", "come")):
        return ""
    if governor.lemma in TO_INFINITIVE_VERBS:
        return "to"
    return None


def _is_recipient(np: Tree) -> bool:
    return any(
        token.tag in PRONOUN_TAGS or token.word in ANIMATE_NOUNS or token.surface[:1].isupper()
        for token in np.leaves()
    )


def _comp_penalty(comp: Tree, governor: Token | None) -> int | None:
    labels = [kid.label() for kid in comp]
    if labels.count("NP") == 2 and (governor is None or governor.lemma not in DITRANSITIVE):
        return None
    penalty = 0
    for kid in comp:
        if kid.label() == "WHCL":
            nested = _child(kid, {"COMP"})
            if nested is not None:
                nested_penalty = _comp_penalty(nested, _main_verb(_child(kid, {"VG"})))
                if nested_penalty is None:
                    return None
                penalty += nested_penalty
            continue
        if kid.label() != "INF":
            continue
        if _child(kid, {"TO"}) is None:
            if _infinitive_marker(governor, after_object="NP" in labels) is None:
                return None
            penalty += BARE_INFINITIVE_PENALTY
        nested = _child(kid, {"COMP"})
        if nested is not None:
            nested_penalty = _comp_penalty(nested, _head_token(_child(kid, {"VERB"})))
            if nested_penalty is None:
                return None
            penalty += nested_penalty
    return penalty


def _subject_strength(np: Tree | None) -> int:
    """How plausible an NP is as the subject: nominative pronoun > other pronoun / animate noun > noun."""
    strength = 0
    for token in np.leaves() if np is not None else ():
        if token.tag == "pron_s":
            score = 3
        elif token.tag == "pron_o" or token.word == "you":
            score = 2
        elif token.tag == "pron":
            score = 1
        elif token.tag == "n":
            score = 2 if token.word in ANIMATE_NOUNS or token.surface[:1].isupper() else 1
        else:
            continue
        strength = max(strength, score)
    return strength


def _rank(tree: Tree) -> tuple[int, int, int, int] | None:
    """Sort key for a candidate parse (lower wins), or None if a lexical rule rules it out."""
    fragments = strength = penalty = clauses = 0
    for pattern in tree.subtrees(lambda node: node.label() in PATTERN_PENALTY):
        label = pattern.label()
        clauses += 1
        fragments += label == "FRAG"
        penalty += PATTERN_PENALTY[label]
        strength += _subject_strength(_child(pattern, NP_LABELS))
        verb = _main_verb(_child(pattern, {"VG"}))
        if label in ("VSO", "VOS") and verb is not None and verb.lemma in DITRANSITIVE:
            return None
        comp = _child(pattern, {"COMP"})
        if comp is not None:
            comp_penalty = _comp_penalty(comp, verb)
            if comp_penalty is None:
                return None
            penalty += comp_penalty
    for node in tree.subtrees():
        kids = [kid.label() for kid in node if isinstance(kid, Tree)]
        if node.label() == "PP" and kids[0] == "NP":
            penalty += POSTPOSITION_PENALTY
        elif node.label() == "NOM" and kids == ["NOM"] and len(node) == 2:
            penalty += COMPOUND_NOUN_PENALTY
    return fragments, -strength, penalty, clauses


@dataclass(frozen=True, slots=True)
class _Forest:
    """Candidate trees of one word-class sequence, with leaves replaced by token positions."""

    templates: tuple[Tree, ...]
    edges: int


class _ForestCache:
    def __init__(self, size: int) -> None:
        self.size = size
        self._forests: OrderedDict[tuple[str, ...], _Forest] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple[str, ...]) -> _Forest | None:
        with self._lock:
            forest = self._forests.get(key)
            if forest is not None:
                self._forests.move_to_end(key)
            return forest

    def put(self, key: tuple[str, ...], forest: _Forest) -> None:
        with self._lock:
            self._forests[key] = forest
            self._forests.move_to_end(key)
            while len(self._forests) > self.size:
                self._forests.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._forests.clear()

    def __len__(self) -> int:
        return len(self._forests)


_forests = _ForestCache(PARSE_CACHE_SIZE)


def clear_parse_cache() -> None:
    _forests.clear()


def _template(tree: Tree, positions: "count[int]") -> Tree:
    # A complete parse covers every token once, in order, so the n-th leaf is token n.
    return Tree(tree.label(), [_template(kid, positions) if isinstance(kid, Tree) else next(positions) for kid in tree])


def _instantiate(template: Tree, tokens: list[Token]) -> Tree:
    return Tree(template.label(), [_instantiate(kid, tokens) if isinstance(kid, Tree) else tokens[kid] for kid in template])


def _parse(tokens: list[Token], edge_budget: int, use_cache: bool = True) -> tuple[Tree | None, int]:
    """Best-ranked parse and the chart edges it cost. Going over budget costs the whole budget.

    A cached forest keeps the edge count its chart needed, so the budget decides exactly as a fresh parse would.
    """
    if not tokens or edge_budget <= 0:
        return None, 0
    key = tuple(token.tag for token in tokens)
    forest = _forests.get(key) if use_cache else None
    if forest is not None:
        if forest.edges > edge_budget:
            return None, edge_budget
        candidates = [_instantiate(template, tokens) for template in forest.templates]
        edges = forest.edges
    else:
        reset = _edge_budget.set(edge_budget)
        try:
            chart = PARSER.chart_parse(tokens)
            # NLTK materializes the whole forest and raises ValueError past its own tree budget.
            candidates = list(islice(chart.parses(GRAMMAR.start()), MAX_CANDIDATE_PARSES))
        except (_ChartBudgetExceeded, ValueError):
            return None, edge_budget
        finally:
            _edge_budget.reset(reset)
        edges = chart.num_edges()
        if use_cache:
            _forests.put(key, _Forest(tuple(_template(candidate, count()) for candidate in candidates), edges))
    best, best_key = None, None
    for candidate in candidates:
        rank = _rank(candidate)
        if rank is not None and (best_key is None or rank < best_key):
            best, best_key = candidate, rank
    return best, edges


# ---------------------------------------------------------------------------
# Canonical English AST construction
# ---------------------------------------------------------------------------
PRETERMINAL_LABELS = {
    "pron_s": "PRON", "pron_o": "PRON", "pron": "PRON", "det": "DET", "n": "N", "adj": "ADJ",
    "deg": "DEG", "adv": "ADV", "v": "V", "ving": "V", "aux": "AUX", "cop": "COP", "neg": "NEG",
    "p": "P", "to": "TO", "wh": "WH", "conj": "CONJ",
}


def _pre(token: Token, case: str | None = None) -> Tree:
    text = token.surface
    if token.tag in PRONOUN_TAGS:
        word = token.word
        if case == "nom":
            word = NOMINATIVE.get(word, word)
        elif case == "acc":
            word = ACCUSATIVE.get(word, word)
        text = "I" if word == "i" else word
    return Tree(PRETERMINAL_LABELS[token.tag], [text])


def _neg(token: Token) -> Tree:
    return Tree("NEG", ["not" if token.word == "no" else token.word])


def _np(node: Tree, case: str | None) -> Tree:
    kids = [kid for kid in node if isinstance(kid, Tree)]
    if any(kid.label() == "CONJ" for kid in kids):
        return Tree("NP", [
            _pre(_head_token(kid)) if kid.label() == "CONJ" else _np(kid, case) for kid in kids
        ])
    return Tree("NP", [_pre(token, case) for token in node.leaves()])


def _pp(node: Tree) -> Tree:
    return Tree("PP", [
        Tree("P", [_head_token(_child(node, {"PREP"})).word]),
        _np(_child(node, {"NP"}), "acc"),
    ])


def _adjp(node: Tree) -> Tree:
    tokens = sorted(node.leaves(), key=lambda token: token.tag != "deg")
    return Tree("ADJP", [_pre(token) for token in tokens])


def _pred(node: Tree) -> Tree:
    inner = node[0]
    if inner.label() == "ADJP":
        return _adjp(inner)
    if inner.label() == "PP":
        return _pp(inner)
    return _np(inner, None)


def _comp(node: Tree, governor: Token | None) -> list[Tree]:
    nps = [kid for kid in node if kid.label() == "NP"]
    if len(nps) == 2 and _is_recipient(nps[1]) and not _is_recipient(nps[0]):
        nps.reverse()
    parts: list[Tree] = [_np(np, "acc") for np in nps]
    for kid in node:
        if kid.label() == "PPS":
            parts.extend(_pp(pp) for pp in kid.subtrees(lambda sub: sub.label() == "PP"))
        elif kid.label() == "INF":
            parts.append(_infinitive(kid, governor, after_object=bool(nps)))
        elif kid.label() == "WHCL":
            parts.append(_embedded_question(kid))
    return parts


def _embedded_question(node: Tree) -> Tree:
    """Indirect question: wh-word + statement word order, e.g. (I know) where my shoes are."""
    subject = _child(node, NP_LABELS)
    vg = _child(node, {"VG"})
    comp = _child(node, {"COMP"})
    comp_parts = _comp(comp, _main_verb(vg)) if comp is not None else []
    if vg is None:
        agreement = _agreement(subject)
        cop = _head_token(_child(node, {"COP"}))
        neg = _head_token(_child(node, {"NEG"}))
        pred = _child(node, {"PRED"})
        verbs = [Tree("COP", [_copula(agreement, past=cop.word in PAST_COPULAS)])]
        verbs += [_neg(neg)] if neg is not None else []
        verbs += [_pred(pred)] if pred is not None else []
        body = [_np(subject, "nom"), Tree("VP", verbs)]
    elif subject is None:
        body = [Tree("VP", _declarative_verbs(vg, "3sg", imperative=False) + comp_parts)]
    else:
        verbs = _declarative_verbs(vg, _agreement(subject), imperative=False)
        body = [_np(subject, "nom"), Tree("VP", verbs + comp_parts)]
    return Tree("SBAR", [_pre(_head_token(_child(node, {"WH"}))), Tree("S", body)])


def _infinitive(node: Tree, governor: Token | None, after_object: bool) -> Tree:
    verb = _head_token(_child(node, {"VERB"}))
    marker = "to" if _child(node, {"TO"}) is not None else _infinitive_marker(governor, after_object)
    parts = [Tree("TO", [marker])] if marker else []
    parts.append(Tree("V", [verb.lemma or verb.surface]))
    comp = _child(node, {"COMP"})
    if comp is not None:
        parts.extend(_comp(comp, verb))
    return Tree("VP", parts)


def _agreement(np: Tree | None) -> str:
    """'1sg', '2', '3sg' or 'pl' for the subject NP; no subject means imperative (2nd person)."""
    if np is None:
        return "2"
    tokens = np.leaves()
    if any(token.tag == "conj" for token in tokens):
        return "pl"
    pronoun = next((token for token in tokens if token.tag in PRONOUN_TAGS), None)
    if pronoun is not None:
        word = NOMINATIVE.get(pronoun.word, pronoun.word)
        return {"i": "1sg", "you": "2", "we": "pl", "they": "pl", "these": "pl", "those": "pl"}.get(word, "3sg")
    det = next((token.word for token in tokens if token.tag == "det"), None)
    if det in PLURAL_DETERMINERS or (det is not None and det.isdigit() and det != "1"):
        return "pl"
    head = tokens[-1].word
    if head in PLURAL_NOUNS or (head.endswith("s") and not head.endswith(("ss", "us", "is"))):
        return "pl"
    return "3sg"


def _copula(agreement: str, past: bool = False) -> str:
    if past:
        return "was" if agreement in ("1sg", "3sg") else "were"
    return {"1sg": "am", "3sg": "is"}.get(agreement, "are")


def _agree_aux(aux: Token, agreement: str) -> str:
    if aux.tag == "cop":
        return _copula(agreement, past=aux.word in PAST_COPULAS)
    if aux.word in ("do", "does"):
        return "does" if agreement == "3sg" else "do"
    return aux.word


def _do_support(verb: Token, agreement: str) -> str:
    if verb.vform == "past":
        return "did"
    return "does" if agreement == "3sg" else "do"


def _base(verb: Token) -> str:
    return verb.lemma or verb.surface


def _finite(verb: Token, agreement: str) -> str:
    if verb.lemma is None or verb.vform in ("past", "ing"):
        return verb.surface
    return THIRD_PERSON[verb.lemma] if agreement == "3sg" else verb.lemma


def _verb_parts(vg: Tree) -> tuple[Token | None, Token | None, Token]:
    aux = neg = verb = None
    for kid in vg:
        if kid.label() == "AUXL":
            aux = _head_token(kid)
        elif kid.label() == "NEG":
            neg = _head_token(kid)
        else:
            verb = _head_token(kid)
    return aux, neg, verb


def _declarative_verbs(vg: Tree, agreement: str, imperative: bool) -> list[Tree]:
    aux, neg, verb = _verb_parts(vg)
    negation = [_neg(neg)] if neg is not None else []
    if aux is not None:
        main = verb.surface if aux.tag == "cop" else _base(verb)
        return [Tree("AUX", [_agree_aux(aux, agreement)]), *negation, Tree("V", [main])]
    if verb.vform == "ing" and not imperative:
        return [Tree("AUX", [_copula(agreement)]), *negation, Tree("V", [verb.surface])]
    if neg is not None and neg.word != "never" and verb.lemma is not None:
        return [Tree("AUX", [_do_support(verb, agreement)]), *negation, Tree("V", [_base(verb)])]
    main = _base(verb) if imperative else _finite(verb, agreement)
    return [*negation, Tree("V", [main])]


def _inverted_verbs(vg: Tree, agreement: str, front: Token | None = None) -> tuple[Tree, list[Tree]]:
    """Split a verb group for subject-auxiliary inversion: (fronted auxiliary, remaining verbs)."""
    aux, neg, verb = _verb_parts(vg)
    front = front or aux
    negation = [_neg(neg)] if neg is not None else []
    if front is not None:
        fronted = _agree_aux(front, agreement)
        main = verb.surface if front.tag == "cop" else _base(verb)
        rest = ([Tree("AUX", [aux.word])] if aux is not None and aux is not front else [])
        return Tree("AUX", [fronted]), [*rest, *negation, Tree("V", [main])]
    if verb.vform == "ing":
        return Tree("AUX", [_copula(agreement)]), [*negation, Tree("V", [verb.surface])]
    return Tree("AUX", [_do_support(verb, agreement)]), [*negation, Tree("V", [_base(verb)])]


def _question(pattern: Tree) -> Tree:
    label = pattern.label()
    subject = _child(pattern, NP_LABELS)
    agreement = _agreement(subject)
    vg = _child(pattern, {"VG"})
    comp = _child(pattern, {"COMP"})
    front = _head_token(_child(pattern, {"QAUX"}))
    cop = _head_token(_child(pattern, {"COP"}))
    neg = _head_token(_child(pattern, {"NEG"}))
    pred = _child(pattern, {"PRED"})

    if pred is not None and subject is not None:  # is he hungry / why you are (not) sad
        negation = [_neg(neg)] if neg is not None else []
        copula = Tree("COP", [_agree_aux(cop, agreement)])
        sq = Tree("SQ", [copula, _np(subject, "nom"), *negation, _pred(pred)])
    elif pred is not None:  # WHQ: where are my shoes
        pred_agreement = _agreement(pred[0]) if pred[0].label() == "NP" else "3sg"
        sq = Tree("SQ", [Tree("COP", [_agree_aux(cop, pred_agreement)]), _pred(pred)])
    elif vg is None:  # WHQ with no verb: where mom / mom where / where my shoes are
        copula = _agree_aux(cop, agreement) if cop is not None else _copula(agreement)
        sq = Tree("SQ", [Tree("COP", [copula]), _np(subject, "nom")])
    elif subject is None:  # WHQ with wh-subject: who want water
        comp_parts = _comp(comp, _main_verb(vg)) if comp is not None else []
        sq = Tree("SQ", [Tree("VP", _declarative_verbs(vg, "3sg", imperative=False) + comp_parts)])
    else:
        fronted, verbs = _inverted_verbs(vg, agreement, front)
        comp_parts = _comp(comp, _main_verb(vg)) if comp is not None else []
        sq = Tree("SQ", [fronted, _np(subject, "nom"), Tree("VP", verbs + comp_parts)])

    if label == "YNQ":
        return sq
    return Tree("SBARQ", [_pre(_head_token(_child(pattern, {"WH"}))), sq])


def _clause(pattern: Tree) -> Tree:
    label = pattern.label()
    if label in ("YNQ", "WHQ"):
        return _question(pattern)
    if label == "FRAG":
        inner = pattern[0]
        if inner.label() == "PP":
            return Tree("FRAG", [_pp(inner)])
        if inner.label() == "ADJP":
            return Tree("FRAG", [_adjp(inner)])
        return Tree("FRAG", [_np(inner, None)])

    subject = _child(pattern, NP_LABELS)
    agreement = _agreement(subject)
    if label in COPULAR:
        cop = _head_token(_child(pattern, {"COP"}))
        neg = _head_token(_child(pattern, {"NEG"}))
        verbs = [Tree("COP", [_copula(agreement, past=cop is not None and cop.word in PAST_COPULAS)])]
        if neg is not None:
            verbs.append(_neg(neg))
        predicate = _pred(_child(pattern, {"PRED", "ZPRED"}))
        return Tree("S", [_np(subject, "nom"), Tree("VP", [*verbs, predicate])])

    vg = _child(pattern, {"VG"})
    comp = _child(pattern, {"COMP"})
    comp_parts = _comp(comp, _main_verb(vg)) if comp is not None else []
    verbs = _declarative_verbs(vg, agreement, imperative=subject is None)
    vp = Tree("VP", verbs + comp_parts)
    return Tree("S", [vp] if subject is None else [_np(subject, "nom"), vp])


def _canonical(tree: Tree) -> list[Tree]:
    parts: list[Tree] = []
    node = tree
    while node is not None:
        cl = _child(node, CLAUSE_LABELS)
        if cl[0].label() == "XCL":
            cl = cl[0]
        leading, trailing = [], []
        pattern = None
        for kid in cl:
            if kid.label() != "ADVP":
                pattern = next(kid.subtrees(lambda sub: sub.label() in PATTERN_PENALTY))
            else:
                advp = Tree("ADVP", [_pre(token) for token in kid.leaves()])
                (trailing if pattern is not None else leading).append(advp)
        clause = _clause(pattern)
        for advp in reversed(leading):
            clause.insert(0, advp)
        clause.extend(trailing)
        parts.append(clause)
        conj = _child(node, {"CONJ"})
        if conj is not None:
            parts.append(_pre(_head_token(conj)))
        node = _child(node, {"XS"})
    return parts


def _render(root: Tree) -> str:
    words = [word for word in root.leaves() if word]
    if not words:
        return ""
    text = " ".join(words)
    is_question = len(root) > 0 and root[-1].label() in ("SQ", "SBARQ")
    return text[0].upper() + text[1:] + ("?" if is_question else ".")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Translation:
    formatted_text: str
    parsed_tree: str
    original_tokens: list[str]
    latency_ms: float
    unparsed_groups: int = 0


def _clause_groups(tokens: list[Token]) -> list[tuple[Token | None, list[Token]]]:
    """Split at conjunctions so each clause parses alone (the forest grows exponentially otherwise).

    A segment with no verb, copula, auxiliary or wh-word stays joined to its neighbour, which keeps
    NP coordination ("me and mom go", "tea and water") and zero-copula clauses in one parse, unless the
    joined group would pass MAX_GROUP_TOKENS: then a long verbless run cannot swallow the next clause.
    Returns (conjunction before the group, group tokens) pairs.
    """
    groups: list[tuple[Token | None, list[Token]]] = []
    verbal: list[bool] = []
    conj: Token | None = None
    segment: list[Token] = []
    for token in [*tokens, None]:
        if token is not None and token.tag != "conj":
            segment.append(token)
            continue
        has_verb = any(item.tag in VERBAL_TAGS for item in segment)
        fits = bool(groups) and len(groups[-1][1]) + 1 + len(segment) <= MAX_GROUP_TOKENS
        if fits and (not has_verb or not verbal[-1]):
            groups[-1][1].extend([conj, *segment] if conj is not None else segment)
            verbal[-1] = verbal[-1] or has_verb
        elif segment:
            groups.append((conj, segment))
            verbal.append(has_verb)
        conj, segment = token, []
    return groups


def _transduce_group(tokens: list[Token], edge_budget: int, use_cache: bool = True) -> tuple[list[Tree], int]:
    if len(tokens) > MAX_GROUP_TOKENS:
        return [_unparsed(tokens)], 0
    tree, used = _parse(tokens, edge_budget, use_cache)
    lifted: list[Token] = []
    if tree is None and any(token.tag == "adv" for token in tokens):
        # Retry with free-floating adverbs lifted out, then reattach them clause-final.
        lifted = [token for token in tokens if token.tag == "adv"]
        tree, retry_used = _parse([token for token in tokens if token.tag != "adv"], edge_budget - used, use_cache)
        used += retry_used
    if tree is None:
        return [_unparsed(tokens)], used
    clauses = _canonical(tree)
    if lifted:
        clauses[-1].append(Tree("ADVP", [_pre(token) for token in lifted]))
    return clauses, used


def _unparsed(tokens: list[Token]) -> Tree:
    """Cleaned words in their original order: nothing the speaker said is dropped when parsing gives up."""
    return Tree("UNPARSED", [_pre(token) for token in tokens])


def transduce(tokens: list[Token], use_cache: bool = True) -> Tree:
    groups = _clause_groups(tokens)
    results: list[list[Tree]] = [[] for _ in groups]
    edge_budget = MAX_CHART_EDGES
    # Shortest groups spend the shared budget first, so one long clause cannot starve the short ones.
    for index in sorted(range(len(groups)), key=lambda position: (len(groups[position][1]), position)):
        results[index], used = _transduce_group(groups[index][1], edge_budget, use_cache)
        edge_budget -= used

    parts: list[Tree] = []
    for (conj, _), clauses in zip(groups, results):
        if conj is not None and parts:
            parts.append(_pre(conj))
        parts.extend(clauses)
    return Tree("ROOT", parts)


# Everyday utterance shapes whose forests are parsed once at startup, so the first request of each shape
# is not the slow one. They include the sentences Pitch Mode replays (frontend/src/lib/hud/simulated.ts).
WARMUP_UTTERANCES: tuple[tuple[str, ...], ...] = (
    ("um", "me", "w-w-water", "want"),
    ("I", "I", "w-want", "to", "go", "to", "the", "store"),
    ("can", "can", "you", "c-call", "my", "mom"),
    ("where", "my", "shoes", "are"),
    ("cold", "water", "please", "I", "want"),
    ("i", "i", "need", "uh", "my", "m-m-medicine"),
    ("the", "the", "b-bus", "is", "late"),
    ("i", "am", "tired"),
    ("help", "me", "please"),
    ("i", "dont", "want", "it"),
    ("what", "is", "your", "name"),
    ("water", "please"),
)


def warm_parse_cache() -> int:
    """Parses WARMUP_UTTERANCES into the forest cache; returns how many forests it holds."""
    for tokens in WARMUP_UTTERANCES:
        translate(list(tokens))
    return len(_forests)


def translate(raw_tokens: list[str], *, use_cache: bool = True) -> Translation:
    """use_cache=False always runs the chart parser; the health check and the benchmark time that path."""
    start = time.perf_counter()
    root = transduce(_lex(_normalize(raw_tokens)), use_cache)
    formatted = _render(root)
    parsed = root.pformat(margin=sys.maxsize)
    unparsed = sum(1 for part in root if part.label() == "UNPARSED")
    if unparsed:
        log.warning("%d clause group(s) of a %d-token input were returned unparsed", unparsed, len(raw_tokens))
    return Translation(
        formatted_text=formatted,
        parsed_tree=parsed,
        original_tokens=list(raw_tokens),
        latency_ms=(time.perf_counter() - start) * 1000,
        unparsed_groups=unparsed,
    )


router = APIRouter(prefix="/api/grammar", tags=["grammar"])


@router.post("/translate", response_model=GrammarResponseSchema)
def translate_tokens(request: GrammarRequestSchema, response: Response) -> GrammarResponseSchema:
    if request.sourceLang != "en":
        raise HTTPException(status_code=422, detail=f"Unsupported sourceLang '{request.sourceLang}'; only 'en' has a grammar")
    result = translate(request.rawSpeechTokens)
    # Clause groups the engine could not reorder; they are still in parsedTree as UNPARSED nodes.
    response.headers[UNPARSED_HEADER] = str(result.unparsed_groups)
    return GrammarResponseSchema(
        formattedText=result.formatted_text,
        parsedTree=result.parsed_tree,
        originalTokens=result.original_tokens,
        executionLatencyMs=round(result.latency_ms, 3),
    )
