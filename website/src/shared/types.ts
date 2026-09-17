// Profile Preset Modes
export type ProfileMode = 
  | 'clearvoice' 
  | 'fluency' 
  | 'vocal_assist' 
  | 'therapy' 
  | 'aphasia' 
  | 'sensory' 
  | 'pitch_demo';

// Real-time Audio & Biomarker Telemetry Frame
export interface AudioTelemetryFrame {
  timestamp: number;
  volumeDb: number;
  pitchHz: number;
  spectralBins: number[]; // 128-bin FFT
  jitterPercent: number;  // Pitch instability
  shimmerDb: number;      // Amplitude variation
  hnrDb: number;          // Harmonics-to-Noise Ratio
  vocalStrainIndex: number; // 0 - 100
}

// Pediatric & Articulation Formant Coordinates
export interface FormantData {
  f1: number; // Tongue height (Hz)
  f2: number; // Tongue advancement (Hz)
  f3: number; // Lip rounding (Hz)
  accuracyScore: number; // 0 - 100% match against target
}

// Micro-Acoustic AAC Fingerprint Profile
export interface AcousticTriggerProfile {
  id: string;
  name: string;
  spectralFingerprint: number[]; // 128-bin power spectrum (audio.worker spectralBins), values >= 0
  mappedPhrase: string;
  targetAction: 'DIRECT_PASTE' | 'TTS_SPOKEN' | 'WEBRTC_ALERT' | 'OS_HOTKEY';
  threshold: number; // Similarity confidence threshold
}

// Stutter & Fluency Cadence Metrics
export interface FluencyMetrics {
  wpm: number;
  vocalBlockDetected: boolean;
  blockDurationMs: number;
  pitchVolatilityHz: number;
  dafDelayMs: number;
  fsfOctaveShift: number;
}

// AST CFG Grammar Rule Payload
export interface GrammarRequest {
  rawSpeechTokens: string[];
  sourceLang: string;
  targetProfile: ProfileMode;
}

export interface GrammarResponse {
  formattedText: string;
  parsedTree: string; // CFG Syntax Tree visualization
  originalTokens: string[];
  executionLatencyMs: number;
}

// System State & Direct Paste
export interface SystemState {
  activeProfile: ProfileMode;
  isDirectPasteActive: boolean;
  webRtcPeerConnected: boolean;
  latencyMs: number;
}

// Partial trigger update (PATCH /api/triggers/{id}); omitted fields keep their stored values
export type AcousticTriggerUpdate = Partial<Omit<AcousticTriggerProfile, 'id'>>;

// FFT Peak Matching (POST /api/triggers/match)
export interface AcousticMatchRequest {
  spectralFingerprint: number[]; // 128-bin power spectrum, values >= 0
  topK?: number; // 1 - 20, default 3
}

export interface AcousticMatchCandidate {
  triggerId: string;
  name: string;
  mappedPhrase: string;
  targetAction: AcousticTriggerProfile['targetAction'];
  threshold: number;
  score: number; // 0 - 1 similarity
  distance: number; // 1 - score
}

export interface AcousticMatchResponse {
  matched: boolean;
  trigger: AcousticMatchCandidate | null; // best candidate, only when it clears its own threshold
  candidates: AcousticMatchCandidate[]; // best first
  levelDb: number;
  silent: boolean; // below the silence floor, so nothing can match
  executionLatencyMs: number;
}

// Saved DSP presets (/api/presets)
export type PresetParameter = number | string | boolean | null;

export interface ProfilePresetInput {
  name: string;
  mode: ProfileMode;
  dafDelayMs: number; // 0 - 150, 0 = DAF off
  fsfOctaveShift: number; // -0.5 - 0.5 octaves, 0 = FSF off
  parameters?: Record<string, PresetParameter>; // extra settings, e.g. feedbackGain; default {}
}

export interface ProfilePreset extends Required<ProfilePresetInput> {
  id: string;
  createdAt: string; // ISO 8601, UTC
  updatedAt: string; // ISO 8601, UTC
}

// Session analytics (/api/sessions)
export interface SessionAnalyticsInput {
  profileMode: ProfileMode | null;
  wpm: number;
  stutterCount: number; // vocal blocks in the session
  avgBlockDurationMs: number;
  fluencyPercentage: number; // 0 - 100
  sessionDurationSeconds: number; // whole seconds
}

export interface SessionAnalytics extends SessionAnalyticsInput {
  id: string;
  recordedAt: string; // ISO 8601, UTC
}

// GET /api/sessions/summary; averages are weighted by session length (block length by block count)
export interface SessionSummary {
  profileMode: ProfileMode | null; // the filter applied, null for all sessions
  sessions: number;
  totalSeconds: number;
  totalStutters: number;
  averageWpm: number;
  averageFluencyPercentage: number;
  averageBlockDurationMs: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
}

// Personal articulation targets (/api/phonemes/targets)
export interface PhonemeTargetInput {
  phoneme: string; // IPA or ARPAbet label, 1 - 16 characters
  exampleWord?: string | null;
  f1: number; // Hz, > 0
  f2: number; // Hz, > 0
  f3: number; // Hz, > 0
}

export interface PhonemeTarget extends PhonemeTargetInput {
  id: string;
  exampleWord: string | null;
  createdAt: string; // ISO 8601, UTC
}

// Word-finding cues from the phoneme prefix trie (GET /api/phonemes/lookup?prefix=W+AO&limit=10)
export interface PhonemeLookupWord {
  word: string;
  arpabet: string; // with stress digits, e.g. "W AO1 T ER0"
  frequency: number | null;
}

export interface PhonemeLookupBranch {
  phoneme: string; // ARPAbet symbol that extends the prefix
  wordCount: number;
  topWord: string | null;
}

export interface PhonemeLookupResponse {
  prefix: string[]; // normalised ARPAbet symbols, stress removed
  found: boolean; // false when no dictionary word starts this way, or the dictionary is not seeded
  wordCount: number;
  words: PhonemeLookupWord[]; // most frequent first
  next: PhonemeLookupBranch[]; // largest branch first
}

// Caregiver link. CaregiverMessage travels peer-to-peer over the WebRTC data channel and never reaches the backend.
export type CaregiverRole = 'speaker' | 'caregiver';

export interface CaregiverAlert {
  id: string;
  kind: 'vocal-block' | 'fatigue' | 'emergency' | 'trigger' | 'message'; // message: a quick note sent from the speaker's phone
  message: string;
  timestamp: number; // epoch ms
  durationMs?: number;
  origin?: 'phone'; // raised on the speaker's phone and relayed by the server, not sent by the desktop app
}

// Where a reconstructed sentence came from: typed text, opt-in system dictation, or the Studio demo script.
export type SpeechSource = 'manual' | 'system-dictation' | 'on-device' | 'demo'; // on-device: the app's own Whisper, verbatim

// A reconstructed sentence shared with the caregiver as soon as the grammar engine returns it.
export interface CaregiverTranscript {
  id: string;
  source: SpeechSource;
  grammar: GrammarResponse;
  roundTripMs: number; // speech.worker request start to parsed response
  timestamp: number; // epoch ms
}

export type CaregiverMessage =
  | { type: 'telemetry'; telemetry: AudioTelemetryFrame; fluency: FluencyMetrics; latencyMs: number }
  | { type: 'alert'; alert: CaregiverAlert }
  | { type: 'transcript'; transcript: CaregiverTranscript };

// Signalling relay (WebSocket /ws/signal/{room}?role=speaker|caregiver|alerter&client=<id>). The relay forwards offer,
// answer and ice between speaker and caregiver and sends the rest itself. The session token goes in the subprotocols,
// never the URL: offer ['voicematics.signal', 'voicematics.token.<token>']. Close codes: 4401 the speaker or phone has
// no valid session, 4402 its plan has no caregiver_link, 4403 the phone's account is not the speaker's, 4409 the role
// is taken by another device, 4410 this device reconnected and the newer connection replaced this one.
//
// `alerter` is the speaker's phone: it sends PhoneAlertRequest and nothing else. The relay delivers the alert to the
// caregiver and the speaker as { type: 'alert' } and keeps it (up to 10 minutes) until a caregiver answers
// { type: 'alert-ack', id }, resending it to every caregiver that joins meanwhile. The phone hears { type: 'alert-sent' }
// (delivered: a caregiver was in the room) and { type: 'alert-received' } once one acknowledged it. For the phone,
// peerPresent / peer-joined / peer-left are about the caregiver.
export type SignalRole = CaregiverRole | 'alerter';

export interface PhoneAlertRequest {
  type: 'alert';
  kind: 'emergency' | 'message';
  message: string; // 1 - 200 characters
}

export type SignalMessage =
  | { type: 'joined'; room: string; role: SignalRole; peerPresent: boolean }
  | { type: 'alert'; alert: CaregiverAlert }
  | { type: 'alert-sent'; id: string; delivered: boolean }
  | { type: 'alert-ack'; id: string }
  | { type: 'alert-received'; id: string }
  | { type: 'peer-joined'; role: CaregiverRole }
  | { type: 'peer-left'; role: CaregiverRole }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | { type: 'error'; message: string };

// Voicematics website accounts and desktop licences (backend routers/auth.py, stored in data/web_users.db)
export type PlanTier = 'free' | 'pro' | 'lifetime';
export type LicenseStatus = 'active' | 'inactive' | 'invalid' | 'hardware_mismatch';

export interface AuthCredentials {
  email: string;
  password: string; // signup: 8 - 256 characters, hashed with Argon2id
}

export interface WebUser {
  id: string;
  email: string; // stored lower-case
  planTier: PlanTier;
  isActive: boolean;
  createdAt: string; // ISO 8601, UTC
}

export interface LicenseInfo {
  key: string; // VM-XXXX-YYYY-ZZZZ
  tier: PlanTier;
  status: LicenseStatus;
  hardwareBound: boolean;
  activatedAt: string | null;
}

// What a plan unlocks (backend/web_auth/plans.py, the single source of truth). The desktop app and the website
// gate their UI on this list, and the backend enforces it: 403 for a feature outside the plan.
export type Feature =
  | 'clearvoice' // grammar reconstruction and direct paste
  | 'aphasia' // word finder and reconstruction
  | 'sensory' // sensory HUD
  | 'vocal_assist' // acoustic triggers (limited on Free)
  | 'fluency' // DAF / FSF Fluency Coach
  | 'therapy' // vowel plane and articulation targets
  | 'unlimited_triggers'
  | 'caregiver_link'
  | 'analytics'; // session history and summaries

export interface Entitlements {
  tier: PlanTier; // the tier the account is really on, after a lapsed subscription is settled
  features: Feature[];
  triggerLimit: number | null; // null = unlimited
  expiresAt: string | null; // when a monthly or annual plan lapses; null for free and lifetime
}

// GET /api/auth/me (Authorization: Bearer <token>)
export interface AccountResponse {
  user: WebUser;
  license: LicenseInfo | null;
  entitlements: Entitlements;
}

// POST /api/auth/signup (201) and POST /api/auth/login
export interface AuthSessionResponse extends AccountResponse {
  token: string; // HS256 JWT
  tokenType: 'bearer';
  expiresAt: string;
}

// Remembered computers: the desktop app stays signed in without keeping the password. POST /api/auth/devices
// (Bearer) returns a device token once; POST /api/auth/devices/session trades it, on the same machine, for a fresh
// AuthSessionResponse; POST /api/auth/devices/revoke (204) signs the computer out.
export interface DeviceRegisterRequest {
  hardwareId: string; // 8 - 256 characters; only its SHA-256 is stored
  label?: string; // up to 80 characters, e.g. "Linux desktop"
}

export interface DeviceRegisterResponse {
  deviceId: string;
  deviceToken: string;
}

export interface DeviceSessionRequest {
  deviceToken: string;
  hardwareId: string;
}

export interface DeviceRevokeRequest {
  deviceToken: string;
}

// POST /api/license/verify, called by the desktop app on startup. The first call with a hardwareId binds the key
// to that machine; unknown emails, unknown keys and other accounts' keys all answer status 'invalid'.
export interface LicenseVerifyRequest {
  email: string;
  licenseKey: string;
  hardwareId?: string; // 8 - 256 characters; only its SHA-256 is stored
}

export interface LicenseVerifyResponse {
  valid: boolean;
  status: LicenseStatus;
  tier: PlanTier | null;
  hardwareBound: boolean;
  activatedAt: string | null;
  checkedAt: string;
  // What the desktop app may unlock; the free feature set when the key is not valid.
  features: Feature[];
  triggerLimit: number | null;
  expiresAt: string | null;
}

// POST /api/auth/me/delete (Authorization: Bearer <token>), 204: erases the account, its licences, subscriptions and
// remembered computers, and every trigger, preset, session and phoneme target saved under it. 403 = wrong password.
export interface AccountDeleteRequest {
  password: string;
}

// POST /api/license/deactivate (Authorization: Bearer <token>): unbinds the key from its machine.
export interface LicenseDeactivateResponse {
  key: string;
  hardwareBound: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Website billing (mock checkout). Mirror of the "Website billing" block in backend/schemas.py.

export type BillingPeriod = 'monthly' | 'annual' | 'lifetime';
// 'cancelled' keeps access until currentPeriodEnd; 'expired' is a monthly or annual plan whose period ran out.
export type SubscriptionStatus = 'active' | 'replaced' | 'cancelled' | 'expired';
export type PlanId = 'free' | 'pro_monthly' | 'pro_annual' | 'lifetime';
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'card';

// GET /api/billing/plans
export interface PricingPlan {
  id: PlanId;
  tier: PlanTier;
  name: string;
  priceCents: number;
  billingPeriod: BillingPeriod | null; // null for the free plan
  features: string[];
}

// Test numbers only: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined. The backend keeps the
// brand and last four digits and drops the rest.
export interface CardDetails {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name: string;
}

// POST /api/billing/checkout (Authorization: Bearer <token>)
export interface CheckoutRequest {
  planId: Exclude<PlanId, 'free'>;
  card: CardDetails;
}

export interface Subscription {
  id: string;
  planId: PlanId;
  tier: PlanTier;
  billingPeriod: BillingPeriod;
  amountCents: number;
  currency: string;
  cardBrand: CardBrand;
  cardLast4: string;
  status: SubscriptionStatus;
  createdAt: string; // ISO 8601, UTC
  currentPeriodEnd: string | null; // null for lifetime access
  licenseKey: string;
}

export interface CheckoutResponse {
  subscription: Subscription;
  license: LicenseInfo;
  user: WebUser;
  entitlements: Entitlements;
  downloadUrl: string; // the desktop installer, Voicematics-Setup.exe
}

// ---------------------------------------------------------------------------
// The one language-model agent (backend/agents/sentence_refiner.py, routers/agents.py). It runs beside the speech
// path, never in it: ClearVoice's second answer, checked so it only uses words that were said.

export type AgentProvider = 'gemini' | 'groq';

// GET /api/agent/status
export interface AgentStatus {
  available: boolean;
  providers: AgentProvider[]; // in the order they are tried
  primary: AgentProvider | null;
}

// POST /api/agent/refine-sentence (signed in when the backend requires accounts). The second, context-aware answer
// for ClearVoice, asked for after the grammar engine's sentence is already on screen. 'aphasia' is accepted from
// older clients and treated as clearvoice.
export type RefineProfile = 'clearvoice' | 'aphasia';

export interface SentenceRefineRequest {
  rawTokens: string[]; // 1 - 256 words as said, fillers and repeats included
  draft: string; // the grammar engine's formattedText for those words
  profileMode: RefineProfile;
  context: string[]; // up to 6 earlier sentences, oldest first, 500 characters each
}

export interface RefinedSentence {
  text: string;
  modelName: string; // e.g. gemini-flash-latest; a lighter Gemini model or Groq when that one is busy
}
