export type DisfluencyKind = 'repetition' | 'part-word' | 'filler';

const FILLER_PATTERN = /^(um+|uh+|er+|erm|ah+|hmm+)$/i;
const PART_WORD_PATTERN = /^([a-z']+)-([a-z']+)$/i;

/** Rule-based tag for how a raw ASR token differs from fluent speech, used only for display. */
export function classifyToken(tokens: readonly string[], index: number): DisfluencyKind | null {
  const token = tokens[index];
  if (FILLER_PATTERN.test(token)) return 'filler';

  const partWord = PART_WORD_PATTERN.exec(token);
  if (partWord && partWord[2].toLowerCase().startsWith(partWord[1].toLowerCase())) return 'part-word';

  const next = tokens[index + 1];
  if (next !== undefined && next.toLowerCase() === token.toLowerCase()) return 'repetition';

  return null;
}

export const DISFLUENCY_LABELS: Record<DisfluencyKind, string> = {
  repetition: 'repeated word',
  'part-word': 'part-word repetition',
  filler: 'filler',
};
