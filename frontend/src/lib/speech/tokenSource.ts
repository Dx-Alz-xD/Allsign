/**
 * Where the grammar engine's `rawSpeechTokens` come from.
 *
 * The app's rules forbid predictive models, and a speech recognizer is one.
 * Two sources exist today:
 *   - manual: text the person types or pastes (also the test harness for the
 *     grammar engine), always available;
 *   - system dictation: the browser's SpeechRecognition API, which hands the
 *     audio to the operating system's or browser vendor's recognizer. It is
 *     outside the app's own no-model guarantee, so it is opt-in, labelled as
 *     external, and absent in the Electron shell (Chromium exposes the API
 *     there without a working backend).
 */

export type TokenSourceKind = 'manual' | 'system-dictation';

export interface TokenBatch {
  tokens: string[];
  /** False for interim dictation results that may still change. */
  final: boolean;
  source: TokenSourceKind;
}

export type TokenListener = (batch: TokenBatch) => void;

export interface TokenSource {
  readonly kind: TokenSourceKind;
  start(): void;
  stop(): void;
  readonly active: boolean;
}

export function tokenize(text: string): string[] {
  return text
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export class ManualTokenSource implements TokenSource {
  readonly kind = 'manual';
  active = false;

  constructor(private readonly listener: TokenListener) {}

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  submit(text: string): string[] {
    const tokens = tokenize(text);
    if (tokens.length > 0) this.listener({ tokens, final: true, source: 'manual' });
    return tokens;
  }
}

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  // The Electron shell exposes the API but has no recognizer behind it.
  if (window.omnivoice) return null;
  const candidate = (window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor });
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

export function systemDictationAvailable(): boolean {
  return recognitionConstructor() !== null;
}

export class SystemDictationSource implements TokenSource {
  readonly kind = 'system-dictation';
  active = false;
  private recognition: RecognitionLike | null = null;

  constructor(
    private readonly listener: TokenListener,
    private readonly onError: (message: string) => void,
    private readonly lang = 'en-US',
  ) {}

  start(): void {
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      this.onError('System dictation is not available here.');
      return;
    }
    if (this.recognition) return;
    const recognition = new Recognition();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const tokens = tokenize(result[0].transcript);
        if (tokens.length > 0) this.listener({ tokens, final: result.isFinal, source: 'system-dictation' });
      }
    };
    recognition.onerror = (event) => {
      this.onError(`System dictation stopped: ${event.error}`);
      this.stop();
    };
    recognition.onend = () => {
      // Chromium ends continuous sessions on silence; keep listening while active.
      if (this.active && this.recognition === recognition) recognition.start();
    };
    this.recognition = recognition;
    this.active = true;
    recognition.start();
  }

  stop(): void {
    this.active = false;
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.abort();
  }
}
