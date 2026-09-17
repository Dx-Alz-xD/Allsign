'use client';

/**
 * ClearVoice in the browser: speech as the recognizer writes it down (stutters, repeats and fillers kept), the
 * words it would tidy marked, the grammar engine's quick answer, and what direct paste would type in each setting.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Braces, ClipboardPaste, Ear, MessageSquareText, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { reducedMotion } from '@/lib/motion';

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'like']);
const QUESTION_STARTS = new Set(['can', 'could', 'would', 'will', 'do', 'does', 'did', 'is', 'are', 'where', 'what', 'why', 'when', 'who', 'how']);
const EXAMPLES = [
  'I-I-I w-w-want to, um, to go to the, the store',
  'C-c-can you s-send me the, uh, the report by F-Friday',
  'My n-n-name is, is, uh, J-Jordan',
  'Wh-wh-where did you, um, put my, my keys',
  'the the bus is is late again',
];

type Kind = 'filler' | 'stutter' | 'repeat' | null;
type PasteMode = 'heard' | 'quick';

function bare(token: string): string {
  return token.toLowerCase().replace(/[^a-z'-]/g, '');
}

/** The word a stuttered token stands for: "w-w-want" is "want", "I-I-I" is "I". */
function core(token: string): string {
  const parts = token.replace(/[.,!?;:]+$/g, '').split('-').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : token.replace(/[.,!?;:]+$/g, '');
}

function classify(tokens: string[], index: number): Kind {
  const word = bare(tokens[index]);
  if (FILLERS.has(word)) return 'filler';
  if (/^([a-z]{1,3}-)+[a-z']+$/i.test(tokens[index].replace(/[.,!?;:]+$/g, ''))) return 'stutter';
  const previous = tokens.slice(0, index).reverse().find((token) => !FILLERS.has(bare(token)));
  if (previous && core(previous).toLowerCase() === core(tokens[index]).toLowerCase()) return 'repeat';
  return null;
}

const KIND_LABEL: Record<Exclude<Kind, null>, string> = { filler: 'filler', stutter: 'part-word repeat', repeat: 'repeated word' };

/** A stand-in for the grammar engine when the server is not reachable: drop fillers, collapse stutters and repeats. */
function tidyLocally(tokens: string[]): string {
  const words: string[] = [];
  tokens.forEach((token, index) => {
    const kind = classify(tokens, index);
    if (kind === 'filler' || kind === 'repeat') return;
    words.push(core(token));
  });
  if (words.length === 0) return '';
  let sentence = words.join(' ').replace(/\bi\b/g, 'I');
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return `${sentence}${QUESTION_STARTS.has(words[0].toLowerCase()) ? '?' : '.'}`;
}

export function ClearVoiceTab() {
  const [input, setInput] = useState(EXAMPLES[0]);
  const [quick, setQuick] = useState<{ text: string; ms: number; source: 'engine' | 'demo' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<PasteMode>('heard');
  const [typed, setTyped] = useState('');
  const outputRef = useRef<HTMLParagraphElement>(null);
  const typingRef = useRef<number | null>(null);

  const tokens = useMemo(() => input.trim().split(/\s+/).filter(Boolean), [input]);

  const run = async () => {
    if (tokens.length === 0 || busy) return;
    setBusy(true);
    const started = performance.now();
    try {
      const response = await api.grammar({ rawSpeechTokens: tokens.map((token) => token.replace(/,/g, '')).filter(Boolean), sourceLang: 'en', targetProfile: 'clearvoice' });
      setQuick({ text: response.formattedText, ms: response.executionLatencyMs, source: 'engine' });
    } catch {
      setQuick({ text: tidyLocally(tokens), ms: Math.max(0.2, performance.now() - started), source: 'demo' });
    } finally {
      setBusy(false);
    }
  };

  // Rebuild whenever the example changes, a moment after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => void run(), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  useEffect(() => {
    if (quick && outputRef.current && !reducedMotion()) {
      animate(outputRef.current, { opacity: [0, 1], y: [8, 0], duration: 380, ease: 'outCubic' });
    }
  }, [quick]);

  // Direct paste, simulated: the chosen text is typed into the fake chat box a character at a time.
  const pasteText = mode === 'heard' ? input.trim() : (quick?.text ?? '');
  useEffect(() => {
    if (typingRef.current !== null) window.clearInterval(typingRef.current);
    if (reducedMotion()) {
      setTyped(pasteText);
      return;
    }
    setTyped('');
    let index = 0;
    typingRef.current = window.setInterval(() => {
      index += 1;
      setTyped(pasteText.slice(0, index));
      if (index >= pasteText.length && typingRef.current !== null) window.clearInterval(typingRef.current);
    }, 22);
    return () => {
      if (typingRef.current !== null) window.clearInterval(typingRef.current);
    };
  }, [pasteText]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <label htmlFor="clearvoice-input" className="label">
          What the recognizer heard, exactly
        </label>
        <textarea id="clearvoice-input" value={input} onChange={(event) => setInput(event.target.value)} rows={3} className="field font-mono text-lg" />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setInput(example)}
              className={`rounded-full border px-3 py-1 text-xs transition ${example === input ? 'border-ember/60 text-bone' : 'border-white/10 text-smoke hover:border-ember/50 hover:text-bone'}`}
            >
              {example}
            </button>
          ))}
        </div>

        <p className="mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-smoke">
          <Ear aria-hidden className="size-3.5 text-ember" />
          Heard, word for word
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Words as heard">
          {tokens.map((token, index) => {
            const kind = classify(tokens, index);
            return (
              <li key={`${index}-${token}`} className={`rounded-lg px-2 py-1 font-mono text-sm ${kind ? 'border border-dashed border-ember/60 text-ember' : 'bg-white/[0.06] text-bone'}`}>
                {token}
                {kind && <span className="sr-only"> ({KIND_LABEL[kind]})</span>}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-smoke">Dashed: fillers, part-word repeats and repeated words. They stay in the transcript and are left out of the tidied sentence.</p>
      </div>

      <div className="space-y-4">
        <div className="panel p-5">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-smoke">
            <span className="flex items-center gap-2">
              <Braces aria-hidden className="size-3.5 text-ember" />
              Quick answer · grammar rules
            </span>
            <span className="tabular-nums">{quick ? `${quick.ms.toFixed(2)} ms` : busy ? '…' : '—'}</span>
          </div>
          <p ref={outputRef} className="mt-4 min-h-[2.5rem] font-display text-2xl font-semibold text-bone sm:text-3xl" aria-live="polite">
            {quick?.text || <span className="text-smoke/60">The tidied sentence appears here.</span>}
          </p>
          <p className="mt-3 flex items-start gap-2 text-xs text-smoke">
            <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ember" />
            {quick?.source === 'engine'
              ? 'Rebuilt by the real grammar engine. In the app, an optional Gemini answer follows, and it may not add words you did not say.'
              : 'Local demo rules while the server is unreachable. In the app, the real grammar engine and an optional Gemini answer do this.'}
          </p>
        </div>

        <div className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-smoke">
              <ClipboardPaste aria-hidden className="size-3.5 text-ember" />
              Direct paste types
            </p>
            <div role="radiogroup" aria-label="What direct paste types" className="flex rounded-lg border border-white/10 p-0.5 text-xs">
              {(
                [
                  ['heard', 'Exactly what I said'],
                  ['quick', 'Quick answer'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded-md px-2.5 py-1 font-semibold transition ${mode === value ? 'bg-ember/20 text-bone' : 'text-smoke hover:text-bone'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/40">
            <p className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-xs text-smoke">
              <MessageSquareText aria-hidden className="size-3.5" />
              #team-chat · message
            </p>
            <p className="min-h-[4.5rem] px-3 py-3 font-mono text-sm text-bone" aria-live="polite">
              {typed}
              <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-ember" />
            </p>
          </div>
          <p className="mt-3 text-xs text-smoke">In the app this is typed into whichever window has focus, even while Voicematics is minimised.</p>
        </div>
      </div>
    </div>
  );
}
