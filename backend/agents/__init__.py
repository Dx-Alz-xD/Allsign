"""Language-model agents that run beside the speech pipeline, never inside it.

- assistant.py          the website's onboarding chat, with two deterministic tools
- cfg_compiler.py       plain-text correction requests -> validated NLTK CFG rules in grammars/user_custom.cfg
- telemetry_reporter.py session logs -> a ClinicalReport whose numbers are computed here, not by the model
- llm.py                model selection: Gemini first, Groq when a Gemini call fails

The real-time path (grammar_engine, acoustic_matcher, the DSP workers) does not import this package.
"""
