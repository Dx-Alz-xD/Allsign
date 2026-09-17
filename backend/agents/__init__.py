"""The product's one language-model agent, which runs beside the speech pipeline, never inside it.

- sentence_refiner.py  ClearVoice words + the grammar engine's sentence -> a context-aware rebuild, checked so it
                       only uses words that were said
- llm.py               model selection: Gemini first, Groq when a Gemini call fails

The real-time path (grammar_engine, acoustic_matcher, the DSP workers) does not import this package.
"""
