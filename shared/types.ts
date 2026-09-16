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
