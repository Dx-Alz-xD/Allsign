export interface LandmarkFrame {
  timestamp: number;
  landmarks: number[]; // 132-float normalized array (hands + face)
}

export interface DTWTemplate {
  gloss: string;
  category: string;
  vectorSequence: number[][]; // Array of 132-float vectors
}

export interface PredictionResult {
  gloss: string;
  dtwDistance: number;
  confidence: number; // Computed from margin distance ratio
  rawSequence: string[];
}

export interface RuleGrammarRequest {
  glosses: string[];
  sourceLang: string;
  targetLang: string;
}

export interface RuleGrammarResponse {
  formattedSentence: string;
  reorderedGlosses: string[];
}