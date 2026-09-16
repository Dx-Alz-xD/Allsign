# AllSign: OmniVoice OS

OmniVoice OS is an assistive speech desktop app for people who stutter, have aphasia or dysarthria, or speak with little voice. It measures the voice live, rebuilds garbled or out-of-order speech into grammatical sentences, types them into any app, turns hums and other small sounds into actions, and shares alerts and sentences with a caregiver's device.

All processing is deterministic signal processing and rule-based grammar: no generative, predictive or computer-vision model is called anywhere in the app.

The same backend also hosts the account and licence service for the Voicematics website (see [Voicematics accounts](#voicematics-accounts-and-licences)).

## How the pieces fit

| Part | Owner | What it does |
|---|---|---|
| `frontend/` (Next.js 14 in Electron) | Laptop 1 | The desktop shell, HUD, direct paste through nut.js, global shortcuts, and the WebRTC caregiver link |
| `frontend/src/workers`, `frontend/src/worklets` | Laptop 2 | Web Workers and AudioWorklets: FFT, pitch, jitter/shimmer/HNR, LPC formants, speaking rate and blocks, trigger matching, DAF/FSF feedback, and the speech token stream |
| `backend/` (FastAPI, SQLite) | Laptop 3 | NLTK CFG grammar engine, triggers, presets, session analytics, phoneme dictionary, the signalling relay, and Voicematics accounts |
| `shared/types.ts` | everyone | The request and response contract, mirrored 1:1 by `backend/schemas.py` |

### The speech path

1. Words come from typed text, opt-in system dictation, or Pitch Mode's demo script.
2. `speech.worker.ts` groups them into utterances. It waits while `cadence.worker.ts` still hears speech, so a stuttering block does not split a sentence.
3. The worker sends each utterance to `POST /api/grammar/translate`, strictly in order, and retries dictated sentences if the backend is briefly unreachable.
4. Each rebuilt sentence then goes, in the same order, to:
   - the direct paste queue, which types it into the focused app through nut.js;
   - the caregiver data channel, which queues it until the channel is open;
   - the HUD, including Pitch Mode's word-by-word sign overlay.

The microphone path runs in parallel: `captureProcessor.js` feeds `audio.worker.ts`, which fans out to the biomarker, formant, cadence and trigger workers over MessagePorts, so the UI thread never touches raw audio.

## Requirements

- Node.js 20 or newer
- Python 3.11 or newer

## Running it

Backend, from `backend/`:

```bash
python -m venv venv
venv/Scripts/python.exe -m pip install -r requirements-dev.txt
venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
```

On macOS and Linux use `venv/bin/python` instead of `venv/Scripts/python.exe`. Run the API as a single worker: trigger profiles, signalling rooms and the login throttle live in process memory. Interactive API docs are at http://127.0.0.1:8000/docs.

Frontend, from `frontend/`:

```bash
npm install
npm run dev
```

Then open http://localhost:3000, or run the desktop shell against the dev server in a second terminal:

```bash
npm run electron:dev
```

`npm run electron:start` builds the static export and loads it over `app://omnivoice`.

Optional word-finding data for the Aphasia profile needs a Kaggle account (`KAGGLE_USERNAME` and `KAGGLE_KEY` in `backend/.env`):

```bash
venv/Scripts/python.exe scripts/kaggle_sync.py
```

## Tests and checks

| Command | Where | What |
|---|---|---|
| `venv/Scripts/python.exe -m pytest` | `backend/` | API, grammar, matcher, relay, accounts, dataset scripts (in-memory SQLite) |
| `venv/Scripts/python.exe scripts/evaluate_benchmarks.py` | `backend/` | Latency and accuracy report in `backend/EVALUATION_REPORT.md` |
| `npm run typecheck` | `frontend/` | TypeScript for the app and the Electron main process |
| `npm test` | `frontend/` | Worker, worklet and output-path tests (vitest) |
| `npm run build` | `frontend/` | Static export |

## Configuration

`backend/.env` (see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/omnivoice.db` | App data; relative paths resolve against `backend/` |
| `WEB_AUTH_DATABASE_URL` | `sqlite:///./data/web_users.db` | Voicematics accounts and licences |
| `AUTH_JWT_SECRET` | empty | Session signing key, 32+ characters; generated into `data/web_auth_jwt.key` when empty |
| `AUTH_TOKEN_TTL_MINUTES` | `720` | Session length |
| `CORS_ORIGINS`, `CORS_ORIGIN_REGEX` | `http://localhost:3000`, `app://…` and `http://127.0.0.1:*` | Origins allowed to call the API and open the relay |
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | empty | Only for `scripts/kaggle_sync.py` |

`frontend/.env.local` (see `frontend/.env.example`): `NEXT_PUBLIC_BACKEND_URL` (default `http://127.0.0.1:8000`; prefer `127.0.0.1` over `localhost`, which resolves to IPv6 first and makes every new connection wait for a fallback), `NEXT_PUBLIC_STUN_SERVER`, `NEXT_PUBLIC_METERED_API_KEY`, `NEXT_PUBLIC_APP_VERSION`.

`backend/data/` holds the databases, the generated signing key and downloaded datasets, and is git-ignored.

## API

The full endpoint table, with the shared type for each, is in [backend/CLAUDE.md](backend/CLAUDE.md#6-api-surface-sharedtypests---backendschemaspy). The typed client is `frontend/src/lib/api/client.ts`.

## Pitch Mode

Pitch Mode (the `pitch_demo` profile, or the toggle shortcut) is the judges' dashboard:
- live spectrogram and spectrum;
- voice measures and caregiver telemetry;
- the rebuilt sentence with its parse time against the grammar engine's 10 ms budget;
- a sign for each word, shown over the spectrogram and in a strip under the sentence.

Without a microphone it plays a simulated signal and sends a demo sentence through the real grammar engine every 8 seconds. It shows canned output, clearly labelled, only when the backend is offline.

The parse time shown is the server's own measurement, and it depends on whether the sentence's shape has been seen before:
- **Repeated shape:** the server keeps the parse forests of recent word-class sequences ("I want water" and "I want tea" share one), and it parses common shapes, including the demo sentences, at startup. A repeated shape takes well under a millisecond.
- **New shape:** a full chart parse, typically 1–5 ms on a laptop. It can pass 10 ms while the same machine is busy rendering the HUD. `EVALUATION_REPORT.md` gates on this uncached figure.

Sign photos are not bundled. Add them as described in [frontend/public/signs/README.md](frontend/public/signs/README.md); until then each word shows a "No photo yet" card rather than a guessed sign.

## Voicematics accounts and licences

`backend/routers/auth.py`, stored in `backend/data/web_users.db` (tables `users` and `license_keys`):

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/signup` | Email and password. Stores an Argon2id hash, creates a free `VM-XXXX-YYYY-ZZZZ` licence key, returns a JWT session |
| `POST /api/auth/login` | Checks the password, returns a JWT session and the licence status |
| `GET /api/auth/me` | The signed-in account (`Authorization: Bearer <token>`) |
| `POST /api/license/verify` | The desktop app's startup check of email and licence key; the first call with a `hardwareId` binds the key to that machine |

Security details:
- **Passwords:** Argon2id with time cost 3, 64 MiB memory, parallelism 4, a 16-byte salt and a 32-byte hash (`backend/web_auth/passwords.py`). Hashes made with other parameters are upgraded at the next login.
- **Login answers:** a wrong password and an unknown email get the same answer and take the same time.
- **Throttling:** repeated failures for one email are throttled.
- **Session tokens:** HS256, checked for issuer, audience and expiry.
- **Hardware ids:** only their SHA-256 is stored. A bound key does not validate on another machine, or when the id is left out.
- **Licence verification answers:** an unknown email, an unknown key and another account's key all get the same `invalid` answer.

The desktop app does not call the licence check yet; `api.license.verify` in the frontend client is ready for it.

## More

- Data sources and licences: [ATTRIBUTION.md](ATTRIBUTION.md)
- Backend rules and conventions: [backend/CLAUDE.md](backend/CLAUDE.md)
- Original task notes: [docs/task-notes/laptop2.md](docs/task-notes/laptop2.md)
