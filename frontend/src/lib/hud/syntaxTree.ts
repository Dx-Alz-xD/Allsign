export interface SyntaxNode {
  label: string;
  children: SyntaxNode[];
}

/** Parses an NLTK-style bracketed tree, e.g. `(S (NP (PRP I)) (VP (VBP want) (NP (NN water))))`. */
export function parseBracketedTree(input: string): SyntaxNode | null {
  const tokens = input.match(/\(|\)|[^\s()]+/g) ?? [];
  let index = 0;

  const parseNode = (): SyntaxNode | null => {
    if (tokens[index] !== '(') return null;
    index += 1;

    const label = tokens[index];
    if (label === undefined || label === '(' || label === ')') return null;
    index += 1;

    const children: SyntaxNode[] = [];
    while (index < tokens.length && tokens[index] !== ')') {
      if (tokens[index] === '(') {
        const child = parseNode();
        if (!child) return null;
        children.push(child);
      } else {
        children.push({ label: tokens[index], children: [] });
        index += 1;
      }
    }

    if (tokens[index] !== ')') return null;
    index += 1;
    return { label, children };
  };

  const root = parseNode();
  return root && index === tokens.length ? root : null;
}

const TAG_NAMES: Record<string, string> = {
  ROOT: 'Root',
  S: 'Sentence',
  SQ: 'Question',
  SBARQ: 'Wh-question',
  SBAR: 'Clause',
  FRAG: 'Fragment',
  UNPARSED: 'Kept in original order',
  // Labels emitted by backend/grammar_engine.py.
  PRON: 'Pronoun',
  DET: 'Determiner',
  N: 'Noun',
  ADJ: 'Adjective',
  DEG: 'Degree word',
  ADV: 'Adverb',
  V: 'Verb',
  AUX: 'Auxiliary verb',
  COP: 'Copula',
  NEG: 'Negation',
  P: 'Preposition',
  WH: 'Question word',
  CONJ: 'Conjunction',
  NP: 'Noun phrase',
  VP: 'Verb phrase',
  PP: 'Prepositional phrase',
  ADJP: 'Adjective phrase',
  ADVP: 'Adverb phrase',
  INTJ: 'Interjection',
  PRP: 'Personal pronoun',
  PRP$: 'Possessive pronoun',
  NN: 'Noun',
  NNS: 'Plural noun',
  NNP: 'Proper noun',
  VB: 'Verb',
  VBD: 'Past-tense verb',
  VBP: 'Present-tense verb',
  VBZ: 'Present-tense verb',
  MD: 'Modal verb',
  TO: 'To',
  DT: 'Determiner',
  JJ: 'Adjective',
  RB: 'Adverb',
  IN: 'Preposition',
  UH: 'Interjection',
  CC: 'Conjunction',
};

export function describeTag(tag: string): string | undefined {
  return TAG_NAMES[tag];
}
