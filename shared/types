export interface LandmarkFrame {
  timestamp: number;
  landmarks: number[]; // 132-float normalized vector
}

export interface PredictionResult {
  gloss: string;
  confidence: number;
  raw_sequence: string[];
}

export interface GrammarRequest {
  glosses: string[];
  context?: string;
}

export interface GrammarResponse {
  translatedText: string;
  confidence: number;
}