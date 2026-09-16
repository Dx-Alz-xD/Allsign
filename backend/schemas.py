from pydantic import BaseModel
from typing import List, Optional

class LandmarkFrame(BaseModel):
    timestamp: float
    landmarks: List[float]

class PredictionResult(BaseModel):
    gloss: str
    confidence: float
    raw_sequence: List[str]

class GrammarRequest(BaseModel):
    glosses: List[str]
    context: Optional[str] = None

class GrammarResponse(BaseModel):
    translatedText: str
    confidence: float