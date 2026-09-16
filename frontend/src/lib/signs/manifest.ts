/**
 * Static sign photos for the Pitch Mode overlay, described by
 * public/signs/manifest.json (see public/signs/README.md).
 *
 * A reconstructed sentence becomes a sequence of sign tokens. Words with a
 * photo in the manifest show it; words without one show a labelled text card,
 * so a missing photo is never mistaken for a sign. Articles and forms of "be"
 * are marked unsigned, as most sign languages leave them out.
 */

export interface SignEntry {
  /** File name inside public/signs/, e.g. "water.jpg". */
  image: string;
  /** What the photo shows, for screen readers. */
  alt: string;
  /** Photographer and licence, shown under the photo. */
  credit: string;
}

export interface SignManifest {
  version: 1;
  /** Sign language the photos show, e.g. "ASL" or "ISL". Empty until photos are added. */
  language: string;
  /** Overall credit line for the photo set. */
  attribution: string;
  /** Lower-case word -> photo. */
  signs: Record<string, SignEntry>;
}

export interface SignToken {
  /** Position in the sentence, counting every word. */
  index: number;
  /** The word as written in the sentence, punctuation removed. */
  display: string;
  /** Lower-case lookup key. */
  key: string;
  /** False for words sign languages usually leave out. */
  signed: boolean;
  entry: SignEntry | null;
}

export const SIGN_MANIFEST_PATH = 'signs/manifest.json';
export const EMPTY_SIGN_MANIFEST: SignManifest = { version: 1, language: '', attribution: '', signs: {} };

const UNSIGNED_WORDS = new Set(['a', 'an', 'the', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);
const IMAGE_FILE = /^[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp|avif|gif|svg)$/i;
const MAX_ALT_CHARS = 300;
const MAX_CREDIT_CHARS = 300;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Keeps only well-formed entries; image names must be plain files inside public/signs/. */
export function parseSignManifest(value: unknown): SignManifest {
  if (!value || typeof value !== 'object') return EMPTY_SIGN_MANIFEST;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return EMPTY_SIGN_MANIFEST;

  const signs: Record<string, SignEntry> = {};
  if (raw.signs && typeof raw.signs === 'object') {
    for (const [word, candidate] of Object.entries(raw.signs as Record<string, unknown>)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const entry = candidate as Record<string, unknown>;
      const key = normaliseWord(word);
      const image = text(entry.image, 200);
      const alt = text(entry.alt, MAX_ALT_CHARS);
      if (!key || !IMAGE_FILE.test(image) || !alt) continue;
      signs[key] = { image, alt, credit: text(entry.credit, MAX_CREDIT_CHARS) };
    }
  }
  return {
    version: 1,
    language: text(raw.language, 40),
    attribution: text(raw.attribution, MAX_CREDIT_CHARS),
    signs,
  };
}

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function normaliseWord(word: string): string {
  return word.toLowerCase().replace(/[’]/g, "'").replace(EDGE_PUNCTUATION, '');
}

function lookup(key: string, signs: Record<string, SignEntry>): SignEntry | null {
  if (signs[key]) return signs[key];
  const candidates = [key.replace(/'s$/, ''), key.length > 3 && key.endsWith('s') ? key.slice(0, -1) : ''];
  for (const candidate of candidates) if (candidate && signs[candidate]) return signs[candidate];
  return null;
}

export function signTokens(sentence: string, manifest: SignManifest): SignToken[] {
  const tokens: SignToken[] = [];
  for (const word of sentence.split(/\s+/)) {
    const key = normaliseWord(word);
    if (!key) continue;
    const display = word.replace(EDGE_PUNCTUATION, '');
    tokens.push({
      index: tokens.length,
      display,
      key,
      signed: !UNSIGNED_WORDS.has(key),
      entry: lookup(key, manifest.signs),
    });
  }
  return tokens;
}

/** How long each sign stays up: one word at the speaker's rate, within readable bounds. */
export function signHoldMs(wordsPerMinute: number, minMs = 450, maxMs = 1400, fallbackWpm = 120): number {
  const wpm = Number.isFinite(wordsPerMinute) && wordsPerMinute > 20 ? wordsPerMinute : fallbackWpm;
  return Math.min(maxMs, Math.max(minMs, Math.round(60_000 / wpm)));
}

export function signAssetUrl(image: string, base: string): string {
  return new URL(`signs/${image}`, base).href;
}

let cached: Promise<SignManifest> | null = null;

/** Loads the manifest once per page; any failure yields the empty manifest. */
export function loadSignManifest(fetchFn: typeof fetch = fetch, base: string = document.baseURI): Promise<SignManifest> {
  cached ??= fetchFn(new URL(SIGN_MANIFEST_PATH, base).href, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then(parseSignManifest)
    .catch(() => EMPTY_SIGN_MANIFEST);
  return cached;
}

export function resetSignManifestCache(): void {
  cached = null;
}
