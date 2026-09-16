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
