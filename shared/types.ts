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
  spectralFingerprint: number[]; // 128-float FFT snapshot
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