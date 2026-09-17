# AllSign: Voicematics

Voicematics is an assistive speech app for people who stutter, have aphasia or dysarthria, or speak with little voice. It measures the voice live, rebuilds garbled or out-of-order speech into grammatical sentences, types them into any app, turns hums and other small sounds into actions, and shares alerts and sentences with a caregiver's device.

Voicematics is one product, sold as a service: the desktop app (`frontend/`) signs in to a Voicematics account, the website (`website/`) sells and manages plans, and the backend (`backend/`) stores each account's data and enforces what its plan includes (see [Accounts, plans and licences](#accounts-plans-and-licences)). "OmniVoice OS" was the desktop app's codename; it survives only in internal identifiers such as `app://omnivoice`, `window.omnivoice`, `omnivoice.db` and the `omnivoice:` storage keys.

Everything that runs while someone speaks is deterministic signal processing and rule-based grammar: no generative, predictive or computer-vision model is in the speech path. Three language-model agents run beside it, only on request (see [Agents](#agents)).

## How the pieces fit

| Part | Owner | What it does |
|---|---|---|
| `frontend/` (Next.js 14 in Electron) | Laptop 1 | The desktop shell, HUD, direct paste through nut.js, global shortcuts, and the WebRTC caregiver link |
| `frontend/src/workers`, `frontend/src/worklets` | Laptop 2 | Web Workers and AudioWorklets: FFT, pitch, jitter/shimmer/HNR, LPC formants, speaking rate and blocks, trigger matching, DAF/FSF feedback, and the speech token stream |
| `backend/` (FastAPI, SQLite) | Laptop 3 | NLTK CFG grammar engine, per-account triggers, presets, session analytics and phoneme targets, the phoneme dictionary, the signalling relay, and Voicematics accounts, plans and licences |
| `backend/agents/` | Laptop 2 | The website assistant, the grammar-rule compiler and the clinical report writer (Gemini, Groq fallback) |
| `website/` (Next.js 14) | Laptop 2 | The Voicematics landing page: live technology simulator, pricing and mock checkout, account dashboard, assistant widget |
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

Website, from `website/` (expects the backend on port 8000):

```bash
npm install
npm run dev
```

Then open http://localhost:3100.

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
| `npm run typecheck`, `npm run build` | `website/` | TypeScript and the production build of the landing page |

## Configuration

`backend/.env` (see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/omnivoice.db` | App data; relative paths resolve against `backend/` |
| `WEB_AUTH_DATABASE_URL` | `sqlite:///./data/web_users.db` | Voicematics accounts and licences |
| `AUTH_JWT_SECRET` | empty | Session signing key, 32+ characters; generated into `data/web_auth_jwt.key` when empty |
| `AUTH_TOKEN_TTL_MINUTES` | `720` | Session token length; the desktop app renews it with its device token |
| `REQUIRE_ACCOUNT` | `true` | The hosted service: app data, the caregiver relay (speaker side) and clinical reports need a signed-in account, and plans are enforced. `false` lets requests without a token use every feature, for a single-user install |
| `CORS_ORIGINS`, `CORS_ORIGIN_REGEX` | `http://localhost:3000`, `app://…` and `http://127.0.0.1:*` | Origins allowed to call the API and open the relay |
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | empty | Only for `scripts/kaggle_sync.py` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | empty, `gemini-flash-latest` | First provider for the agents |
| `GROQ_API_KEY`, `GROQ_MODEL` | empty, `llama-3.3-70b-versatile` | Used when a Gemini call fails, or alone when only this key is set |
| `AGENT_RATE_LIMIT_PER_MINUTE` | `20` | Agent requests per client address |
| `CUSTOM_GRAMMAR_PATH` | `./grammars/user_custom.cfg` | Where the grammar compiler appends validated rules |
| `INSTALLER_DOWNLOAD_URL` | GitHub release asset | The installer link the website shows after checkout |

`frontend/.env.local` (see `frontend/.env.example`): `NEXT_PUBLIC_BACKEND_URL` (default `http://127.0.0.1:8000`; prefer `127.0.0.1` over `localhost`, which resolves to IPv6 first and makes every new connection wait for a fallback), `NEXT_PUBLIC_STUN_SERVER`, `NEXT_PUBLIC_METERED_API_KEY`, `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_WEBSITE_URL` (default `http://localhost:3100`; where "See plans" opens).

`website/.env.local` (see `website/.env.example`): `NEXT_PUBLIC_BACKEND_URL` (default `http://127.0.0.1:8000`).

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

## Accounts, plans and licences

### Plans

`backend/web_auth/plans.py` is the single source of truth; every account answer carries the account's `entitlements` (tier, features, trigger limit, expiry).

| Feature | Free | Pro, Lifetime | Enforced by the backend |
|---|---|---|---|
| ClearVoice, Aphasia Mode, Sensory HUD, Pitch Demo | yes | yes | the grammar engine and word lookup are public |
| Acoustic triggers | 1 | unlimited | `POST /api/triggers` answers 403 at the limit; over the limit (a lapsed plan) only the oldest triggers are matched |
| Fluency Coach, Therapy Mode | no | yes | presets for those profiles and `/api/phonemes/targets` answer 403 |
| Caregiver Link | watching only | sharing as the speaker | the relay closes a speaker without a session with 4401, on a plan without it with 4402 |
| Session analytics | no | yes | every `/api/sessions` route answers 403 |
| Clinical reports | no | yes | `POST /api/agent/generate-report` answers 403 |

A cancelled monthly or annual plan keeps Pro until the end of its period; a lapsed one drops to Free on the next request. Saved data is never deleted by a downgrade.

### The desktop app

- **Sign-in:** the app opens on a sign-in screen. Signing in registers the computer (`POST /api/auth/devices`) and keeps the returned device token encrypted with the OS keychain through Electron `safeStorage` (`frontend/electron/account.ts`). The password is never stored.
- **Staying signed in:** the device token is traded for fresh session tokens before they expire, and only works on the machine it was issued to.
- **Plan changes:** the plan is re-read every 10 minutes and whenever the window regains focus, so an upgrade on the website shows up without a restart.
- **Offline:** the last confirmed plan keeps working for 7 days.
- **Licence binding:** `POST /api/license/verify` binds a paid licence to one computer (a SHA-256 of the machine id). On another computer the app runs on Free until the licence is moved there from Account.
- **Gating:** every feature stays visible. Home lists them all; a Pro feature on Free shows what it does and how to unlock it instead of its controls.

### Endpoints

`backend/routers/auth.py`, stored in `backend/data/web_users.db` (tables `users`, `license_keys`, `subscriptions`, `device_sessions`):

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/signup` | Email and password. Stores an Argon2id hash, creates a free `VM-XXXX-YYYY-ZZZZ` licence key, returns a JWT session |
| `POST /api/auth/login` | Checks the password, returns a JWT session and the licence status |
| `GET /api/auth/me` | The signed-in account and its entitlements (`Authorization: Bearer <token>`) |
| `POST /api/auth/me/delete` | Signed in, with the password again: erases the account and everything saved with it |
| `POST /api/auth/devices`, `/devices/session`, `/devices/revoke` | Remember a computer, trade its device token for a session on that machine, sign it out |
| `POST /api/license/verify` | The desktop app's check of email and licence key; the first call with a `hardwareId` binds the key to that machine |
| `POST /api/license/deactivate` | Signed in: frees the licence from its machine |

Security details:
- **Passwords:** Argon2id with time cost 3, 64 MiB memory, parallelism 4, a 16-byte salt and a 32-byte hash (`backend/web_auth/passwords.py`). Hashes made with other parameters are upgraded at the next login.
- **Login answers:** a wrong password and an unknown email get the same answer and take the same time.
- **Throttling:** repeated failures for one email are throttled.
- **Session tokens:** HS256, checked for issuer, audience and expiry.
- **Hardware ids:** only their SHA-256 is stored. A bound key does not validate on another machine, or when the id is left out.
- **Licence verification answers:** an unknown email, an unknown key and another account's key all get the same `invalid` answer.
- **Device tokens:** 256 random bits; only their SHA-256 and the machine's fingerprint are stored. Every failure of `/devices/session` gets the same 401. An account keeps at most 10 remembered computers.
- **Relay tokens:** browsers cannot set headers on a WebSocket, so the session token travels as a `voicematics.token.<token>` subprotocol rather than in the URL, where access logs would record it.

## The Voicematics website

`website/` is a separate Next.js 14 app (Tailwind, anime.js) for the public landing page. It is not part of the Electron build and talks only to the local backend.

- Hero, feature cards and an animated waveform grid; "Download Desktop Client" runs a download simulation that ends on the installer link.
- Live technology simulator: Aphasia Assist (sends the fragment to the real grammar engine when the backend is up, local rules otherwise), Vocal Bridge (a synthesised hum through a 128-bin `AnalyserNode`, cosine-matched against an enrolled fingerprint, then a typed phrase and a shortcut), Fluency Coach (DAF 0–200 ms and FSF ±12 st sliders driving a live waveform), Acoustic HUD (an F1/F2 vowel quadrilateral with /i/, /u/, /a/ targets and a Euclidean match score).
- Pricing (Free, Pro monthly or annual, Lifetime), a Stripe-style mock checkout (`POST /api/billing/checkout`: Luhn check, test card `4242 4242 4242 4242`, `4000 0000 0000 0002` is declined, only the brand and last four digits are stored), and a success overlay with the new licence key.
- Account dashboard overlay (plan, licence key, subscription, installer link) and the onboarding assistant widget.

## Agents

`backend/agents/` holds three pydantic-ai agents. They never run while someone is speaking, and the speech path does not import them:

| Agent | Endpoint | What the model does |
|---|---|---|
| `assistant.py` | `POST /api/agent/chat` | Answers onboarding questions with two deterministic tools: `simulate_dsp_delay(sample_rate)` (the capture worklet's latency arithmetic) and `recommend_settings(disfluency_type)` |
| `cfg_compiler.py` | `POST /api/agent/compile-grammar` | Turns a plain-text correction request into NLTK CFG rules; every draft is checked with `nltk.CFG.fromstring()` and against the base grammar, and only validated rules are appended to `backend/grammars/user_custom.cfg`. That file is shared by the whole server, so only a local-mode request saves to it; signed-in accounts get the validated rules back |
| `telemetry_reporter.py` | `POST /api/agent/generate-report` (Pro; Analytics in the desktop app) | Writes the summary paragraph of a `ClinicalReport`; duration, stuttering reduction, the fatigue flag and the DAF recommendation are computed in Python and overwrite whatever the model returns |

Gemini is tried first and Groq takes over when a Gemini call fails. With neither key set the endpoints answer 503 and the website widget shows "Offline". `GET /api/agent/status` reports the configured providers.

## Deploying

The live setup is free-tier: the website on Vercel, the API on Render with Render's free Postgres.

| Piece | Where | How |
|---|---|---|
| Website | Vercel, project `voicematics` (https://voicematics.vercel.app) | `cd website && vercel deploy --prod`; `NEXT_PUBLIC_BACKEND_URL` is set on the project to the API's public URL |
| API | Render, from `render.yaml` | Dashboard: New > Blueprint > this repository > Apply. It creates the `voicematics-api` web service (Docker, free plan) and the `voicematics-db` Postgres (free), wires both `*_DATABASE_URL`s, generates `AUTH_JWT_SECRET`, and asks for the model keys |
| Alternatives | `backend/Dockerfile` + `backend/fly.toml` (Fly.io, paid), `docker-compose.yml` (any VM behind a TLS proxy) | see the comments in each file |
| Desktop app | `frontend/.env.production` | `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_WEBSITE_URL` set to the public URLs before `npm run electron:start` or a packaged build |

What the free tier means:
- **Databases:** Render's free Postgres expires 30 days after creation. For a permanent free database, create one on [Neon](https://neon.tech) and point both `DATABASE_URL` and `WEB_AUTH_DATABASE_URL` at it in the service's environment; the account tables use their own `web_auth` schema, so one database serves both. SQLite stays the default for local runs.
- **Sleep:** the API sleeps after 15 minutes without traffic and takes up to a minute to wake. The website shows "Waking up the server" and keeps checking; the desktop app keeps the last confirmed plan for 7 days.
- **Memory:** 512 MB. Argon2id logins use 64 MiB each, at most four at once.

Production settings for the API are listed in `backend/.env.production.example`; `CORS_ORIGINS` must contain the website's origin. Keep the API at a single instance: the relay rooms, trigger cache and throttles live in process memory.

## More

- Data sources and licences: [ATTRIBUTION.md](ATTRIBUTION.md)
- Backend rules and conventions: [backend/CLAUDE.md](backend/CLAUDE.md)
- Original task notes: [docs/task-notes/laptop2.md](docs/task-notes/laptop2.md)
