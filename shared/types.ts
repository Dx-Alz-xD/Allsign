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
  kind: 'vocal-block' | 'fatigue' | 'emergency' | 'trigger';
  message: string;
  timestamp: number; // epoch ms
  durationMs?: number;
}

// Where a reconstructed sentence came from: typed text, opt-in system dictation, or the Pitch Mode demo script.
export type SpeechSource = 'manual' | 'system-dictation' | 'demo';

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

// Signalling relay (WebSocket /ws/signal/{room}?role=speaker|caregiver&client=<id>). The relay forwards offer,
// answer and ice to the other role and sends the rest itself. Close codes: 4409 the role is taken by another
// device, 4410 this device reconnected and the newer connection replaced this one.
export type SignalMessage =
  | { type: 'joined'; room: string; role: CaregiverRole; peerPresent: boolean }
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

// GET /api/auth/me (Authorization: Bearer <token>)
export interface AccountResponse {
  user: WebUser;
  license: LicenseInfo | null;
}

// POST /api/auth/signup (201) and POST /api/auth/login
export interface AuthSessionResponse extends AccountResponse {
  token: string; // HS256 JWT
  tokenType: 'bearer';
  expiresAt: string;
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
}

// ---------------------------------------------------------------------------
// Website billing (mock checkout). Mirror of the "Website billing" block in backend/schemas.py.

export type BillingPeriod = 'monthly' | 'annual' | 'lifetime';
export type SubscriptionStatus = 'active' | 'replaced' | 'cancelled';
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
  downloadUrl: string; // the desktop installer, Voicematics-Setup.exe
}

// ---------------------------------------------------------------------------
// Language-model agents (backend/agents/, routers/agents.py). They run beside the speech path, never in it:
// the website chat, an authoring-time grammar compiler and a post-session report writer.

export type AgentProvider = 'gemini' | 'groq';

// GET /api/agent/status
export interface AgentStatus {
  available: boolean;
  providers: AgentProvider[]; // in the order they are tried
  primary: AgentProvider | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string; // 1 - 4000 characters
}

// POST /api/agent/chat; the last message must be from the user
export interface ChatRequest {
  messages: ChatMessage[]; // 1 - 40
}

export interface ToolCallRecord {
  name: 'simulate_dsp_delay' | 'recommend_settings' | string;
  args: Record<string, unknown>;
  result: unknown; // DspDelayEstimate | SettingsRecommendation
}

export interface ChatResponse {
  reply: string;
  toolCalls: ToolCallRecord[];
  modelName: string;
}

// simulate_dsp_delay(sample_rate): the desktop app's capture -> analysis latency arithmetic
export interface DspDelayEstimate {
  sampleRate: number;
  captureQuantumMs: number;
  antiAliasTaps: number;
  antiAliasGroupDelayMs: number;
  resampleRatio: number;
  analysisHopMs: number;
  processingMsPerHop: number;
  endToEndMs: number;
  averageMs: number;
  worstCaseMs: number;
  budgetMs: number;
  withinBudget: boolean;
}

export type DisfluencyType = 'stuttering' | 'dysarthria' | 'aphasia';

// recommend_settings(disfluency_type)
export interface SettingsRecommendation {
  disfluencyType: DisfluencyType;
  dafDelayMs: number;
  pitchShiftSemitones: number;
  rationale: string;
}

// POST /api/agent/generate-report
export interface StrainSample {
  timestamp: number; // ms since the session started
  jitterPercent: number;
  shimmerDb: number;
  hnrDb: number;
  strainIndex: number; // 0 - 100
  pitchHz?: number | null;
}

export interface FeedbackEvent {
  timestamp: number; // ms since the session started
  kind: 'daf' | 'fsf' | 'block'; // daf/fsf: feedback switched on or changed; block: a vocal block
  value: number; // delay ms / octave shift / block duration ms
}

export interface SessionLog {
  sessionId?: string | null;
  startedAt?: string | null;
  profileMode?: string | null;
  samples: StrainSample[];
  events: FeedbackEvent[];
  dafDelayMs: number;
  fsfOctaveShift: number;
  speakingMs?: number | null;
}

// The numbers are computed by the backend from the log; the model writes only the paragraph.
export interface ClinicalReport {
  session_duration_minutes: number;
  stuttering_reduction_index: number; // -1 .. 1
  vocal_fatigue_alert: boolean;
  slp_summary_paragraph: string;
  recommended_daf_delay_ms: number;
}

// POST /api/agent/compile-grammar
export interface CompileGrammarRequest {
  prompt: string; // 3 - 1000 characters
  save?: boolean; // default true: append to backend/grammars/user_custom.cfg
}

export interface CFGCompilerOutput {
  grammar_rules: string[]; // NLTK productions, e.g. "WHQ_WHERE -> WH NP COP"
  ast_transform_map: Record<string, string>; // non-terminal -> rebuilt word order
  validation_status: boolean;
}

export interface CompiledGrammar {
  request: string;
  output: CFGCompilerOutput;
  path: string;
  validationRounds: number;
  modelName: string;
  saved: boolean;
}
