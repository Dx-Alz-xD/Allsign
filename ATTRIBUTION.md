# Attribution and Data Usage

This file records the third-party data and software the OmniVoice OS backend (`backend/`) depends on, what each is used for, and the terms that apply. Frontend packages are listed in `frontend/package-lock.json` and are not covered here.

Raw dataset files are downloaded to `backend/data/raw/` by `backend/scripts/kaggle_sync.py`. That folder is git-ignored, so none of the datasets below are redistributed through this repository. Only values derived from them (pronunciations, frequency ranks, the phoneme trie and practice-word lists) are stored in each install's local SQLite database.

## Datasets

### CMU Pronouncing Dictionary (CMUdict)

| | |
|---|---|
| Owner | Carnegie Mellon University (Speech Group, School of Computer Science) |
| Source | Kaggle mirror [`rtatman/cmu-pronouncing-dictionary`](https://www.kaggle.com/datasets/rtatman/cmu-pronouncing-dictionary), uploaded by Rachael Tatman |
| Files used | `cmudict.dict` (word to ARPAbet pronunciations), `cmudict.phones` (phoneme classes) |
| Used for | `pronunciations`, `phonemes`, `phoneme_trie_nodes` and `phoneme_target_words` tables |
| Terms | Copyright 1993-2014 Carnegie Mellon University. Use for research or commercial purposes is unrestricted, and CMU asks that anyone who uses or redistributes the dictionary acknowledge it as the source. The full license is `LICENSE.txt`, downloaded alongside the dictionary. |

Required credit, for the app's About or credits screen:

> Pronunciations from the Carnegie Mellon University Pronouncing Dictionary (CMUdict), Copyright 1993-2014 Carnegie Mellon University.

### English Word Frequency

| | |
|---|---|
| Source | Kaggle [`rtatman/english-word-frequency`](https://www.kaggle.com/datasets/rtatman/english-word-frequency), uploaded by Rachael Tatman |
| Origin | Counts of the 333,333 most frequent words on the English web, derived by Peter Norvig ([norvig.com/ngrams](http://norvig.com/ngrams/)) from the Google Web Trillion Word Corpus (Thorsten Brants and Alex Franz; distributed by the Linguistic Data Consortium as LDC2006T13) |
| Files used | `unigram_freq.csv` |
| Used for | Ranking words in the phoneme trie and the practice-word lists |
| Terms | Kaggle lists the license as "Other". The dataset description states that the code used to generate the counts is MIT-licensed; the counts themselves derive from an LDC-distributed corpus. **Check these terms before any commercial release**, and do not redistribute the raw file. |
| Filtering | The list is scraped web text, so `kaggle_sync.py` drops common profanity, sexual terms and slurs (`BLOCKED_STEMS` / `BLOCKED_WORDS`) when the file is read. `--exclude-words` adds a custom blocklist. |

### Speech Accent Archive (optional)

| | |
|---|---|
| Source | Kaggle [`rtatman/speech-accent-archive`](https://www.kaggle.com/datasets/rtatman/speech-accent-archive), uploaded by Rachael Tatman; the maintained archive is hosted by [George Mason University](http://accent.gmu.edu/) |
| Collected by | Many contributors under the supervision of Steven H. Weinberger |
| Used for | Downloaded only with `kaggle_sync.py --include-speech` (about 951 MB). Nothing in the backend parses or ships it yet. |
| Terms | Creative Commons Attribution-NonCommercial-ShareAlike. Kaggle lists version 4.0 while the dataset description says 2.0; either way it is **non-commercial only**, requires attribution, and derivatives must be shared under the same terms. |

Required citation when the archive is used:

> Weinberger, S. (2013). Speech accent archive. George Mason University.

### Kaggle

Downloads use [`kagglehub`](https://github.com/Kaggle/kagglehub) with each developer's own Kaggle account (`KAGGLE_USERNAME` / `KAGGLE_KEY`), so Kaggle's Terms of Use apply to every download. Each dataset stays under its own license as listed above; Kaggle hosting does not change those terms.

## Software

### NLTK

| | |
|---|---|
| License | Apache License 2.0 |
| Used for | Context-free grammar definitions (`nltk.CFG`) and chart parsing (`IncrementalLeftCornerChartParser`) in `backend/grammar_engine.py` |
| Notes | Only the library code is used. The backend downloads no NLTK corpora or models. |
| Reference | Bird, S., Klein, E. and Loper, E. (2009). *Natural Language Processing with Python*. O'Reilly Media. |

### Other backend dependencies

| Package | License | Used for |
|---|---|---|
| FastAPI | MIT | HTTP API |
| Starlette | BSD-3-Clause | ASGI toolkit underneath FastAPI |
| Pydantic, pydantic-settings | MIT | Request validation and configuration |
| SQLAlchemy | MIT | SQLite ORM |
| Uvicorn | BSD-3-Clause | ASGI server |
| kagglehub | Apache-2.0 | Dataset downloads |
| argon2-cffi | MIT | Argon2id password hashing for Voicematics accounts |
| PyJWT | MIT | Session tokens for Voicematics accounts |
| email-validator (with dnspython, ISC) | Unlicense | Email address validation for Voicematics signups |
| pytest (development) | MIT | Test suite |
| httpx2 (development) | BSD-3-Clause | HTTP client used by FastAPI's test client |

## Synthetic data

The acoustic sounds used by `backend/scripts/evaluate_benchmarks.py` and the backend tests are generated from fixed random seeds. No recordings of people are used in the benchmark.
