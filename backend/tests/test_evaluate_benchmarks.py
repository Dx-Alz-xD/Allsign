from dataclasses import replace

from scripts import evaluate_benchmarks as bench
from tests.test_grammar import CASES

TINY = replace(
    bench.QUICK,
    label="tiny",
    grammar_runs=1,
    takes_per_condition=1,
    negatives_per_sound=1,
    timing_queries=5,
    db_repeats=5,
    lexicon_words=300,
    trigger_library=20,
    session_rows=40,
)


def test_evaluation_covers_every_suite_and_renders_the_report() -> None:
    evaluation = bench.evaluate(TINY, freeze_gc=False, log=lambda _: None)

    known_gaps = sum(1 for case in CASES if case.known_gap)
    assert evaluation.grammar.passed == len(CASES) - known_gaps
    assert not evaluation.grammar.unexpected

    acoustic = evaluation.acoustic
    assert len(acoustic.dataset.positives) == len(bench.ENROLLED_SOUNDS) * len(bench.SNR_CONDITIONS_DB)
    assert len(acoustic.dataset.negatives) == len(bench.NEGATIVE_SOUNDS)
    assert [point.threshold for point in acoustic.sweep] == list(bench.THRESHOLD_SWEEP)
    assert acoustic.library_size == TINY.trigger_library
    # Raising the threshold can only turn fired triggers into misses.
    identified = [point.identification for point in acoustic.sweep]
    assert identified == sorted(identified, reverse=True)

    database = evaluation.database
    assert "synthetic" in database.lexicon_source or "Kaggle" in database.lexicon_source
    assert len(database.queries) == 10 and len(database.api) == 5
    assert database.match_api.timing.samples == TINY.db_repeats
    assert database.match_cold_ms > 0
    assert all(query.timing.samples == TINY.db_repeats for query in database.queries + database.api)

    report = bench.render_report(evaluation)
    for heading in (
        "## Headline results",
        "## 1. AST CFG grammar transduction",
        "## 2. FFT peak matching",
        "### Threshold sweep",
        "## 3. Database queries and API round trips",
        "## Environment",
        "## Appendix: grammar results per case",
    ):
        assert heading in report
    assert "**Overall: " in report
    assert report.count("| `POST /api/triggers` |") == 1
    assert report.count("| `POST /api/triggers/match` |") == 1
