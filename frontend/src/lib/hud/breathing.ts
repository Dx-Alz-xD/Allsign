export type BreathingPhase = 'inhale' | 'exhale' | 'rest';

export interface BreathingPattern {
  id: 'relaxed' | 'easy-onset' | 'slow';
  label: string;
  inhaleMs: number;
  exhaleMs: number;
  restMs: number;
  /** Cue the speaker to start talking gently as the exhale begins. */
  speakOnExhale: boolean;
}

export const BREATHING_PATTERNS: readonly BreathingPattern[] = [
  { id: 'relaxed', label: 'Relaxed', inhaleMs: 4000, exhaleMs: 6000, restMs: 0, speakOnExhale: false },
  { id: 'easy-onset', label: 'Easy onset', inhaleMs: 3000, exhaleMs: 5000, restMs: 1000, speakOnExhale: true },
  { id: 'slow', label: 'Slow', inhaleMs: 5000, exhaleMs: 7000, restMs: 1000, speakOnExhale: false },
];

export interface BreathingGuideState {
  patternId: BreathingPattern['id'];
  running: boolean;
  /** performance.now() at the last start. */
  startedAt: number;
  /** Guide time accumulated before the last start. */
  elapsedBeforeStart: number;
  /** Bumped on reset or pattern change so renderers can drop their voice trail. */
  version: number;
}

export const INITIAL_BREATHING_GUIDE: BreathingGuideState = {
  patternId: 'relaxed',
  running: false,
  startedAt: 0,
  elapsedBeforeStart: 0,
  version: 0,
};

export function getBreathingPattern(id: BreathingPattern['id']): BreathingPattern {
  return BREATHING_PATTERNS.find((pattern) => pattern.id === id) ?? BREATHING_PATTERNS[0];
}

export function cycleMs(pattern: BreathingPattern): number {
  return pattern.inhaleMs + pattern.exhaleMs + pattern.restMs;
}

export function guideElapsedMs(guide: BreathingGuideState, now: number): number {
  return guide.running ? Math.max(0, guide.elapsedBeforeStart + (now - guide.startedAt)) : guide.elapsedBeforeStart;
}

function positionInCycle(pattern: BreathingPattern, elapsedMs: number): number {
  const cycle = cycleMs(pattern);
  return ((elapsedMs % cycle) + cycle) % cycle;
}

/** Target lung volume in [0, 1]: eased rise on the inhale, eased fall on the exhale, flat at rest. */
export function breathingTargetAt(pattern: BreathingPattern, elapsedMs: number): number {
  const t = positionInCycle(pattern, elapsedMs);
  if (t < pattern.inhaleMs) return 0.5 - 0.5 * Math.cos((Math.PI * t) / pattern.inhaleMs);
  if (t < pattern.inhaleMs + pattern.exhaleMs) {
    return 0.5 + 0.5 * Math.cos((Math.PI * (t - pattern.inhaleMs)) / pattern.exhaleMs);
  }
  return 0;
}

export function breathingPhaseAt(
  pattern: BreathingPattern,
  elapsedMs: number,
): { phase: BreathingPhase; remainingMs: number } {
  const t = positionInCycle(pattern, elapsedMs);
  if (t < pattern.inhaleMs) return { phase: 'inhale', remainingMs: pattern.inhaleMs - t };
  if (t < pattern.inhaleMs + pattern.exhaleMs) {
    return { phase: 'exhale', remainingMs: pattern.inhaleMs + pattern.exhaleMs - t };
  }
  return { phase: 'rest', remainingMs: cycleMs(pattern) - t };
}

export function breathingPhaseLabel(pattern: BreathingPattern, phase: BreathingPhase): string {
  if (phase === 'inhale') return 'Breathe in';
  if (phase === 'rest') return 'Rest';
  return pattern.speakOnExhale ? 'Breathe out and start speaking gently' : 'Breathe out slowly';
}
