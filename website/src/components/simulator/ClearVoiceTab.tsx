'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Braces, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm']);
const SUBJECT_PRONOUNS: Record<string, string> = { me: 'I', him: 'he', her: 'she', us: 'we', them: 'they' };
const EXAMPLES = ['where my shoes are', 'me water want', 'what your name is', 'um me w-w-water want', 'why he is late'];

/** Local stand-in for the grammar engine: enough of its rules for the demo to snap the sentence into shape. */
function reorderLocally(input: string): string {
  const words = input
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/^(\w{1,2}-)+/, ''))
    .filter((word) => !FILLERS.has(word));
  const deduped = words.filter((word, index) => index === 0 || word !== words[index - 1]);
  if (deduped.length === 0) return '';

  const wh = deduped[0];
  const copulaIndex = deduped.findIndex((word, index) => index > 0 && ['is', 'are', 'was', 'were'].includes(word));
  if (['where', 'what', 'why', 'when', 'who', 'how'].includes(wh) && copulaIndex === deduped.length - 1 && deduped.length >= 3) {
    const subject = deduped.slice(1, copulaIndex).join(' ');
    return capitalise(`${wh} ${deduped[copulaIndex]} ${subject}?`);
  }

  const verbIndex = deduped.findIndex((word) => ['want', 'need', 'like', 'see', 'have', 'go'].includes(word));
  if (verbIndex === deduped.length - 1 && deduped.length >= 3) {
    const subject = SUBJECT_PRONOUNS[deduped[0]] ?? deduped[0];
    const object = deduped.slice(1, verbIndex).join(' ');
    return capitalise(`${subject} ${deduped[verbIndex]} ${object}.`);
  }
  const subject = SUBJECT_PRONOUNS[deduped[0]] ?? deduped[0];
  return capitalise(`${[subject, ...deduped.slice(1)].join(' ')}.`);
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

type Phase = 'idle' | 'parsing' | 'done';

export function ClearVoiceTab() {
  const [input, setInput] = useState(EXAMPLES[0]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [output, setOutput] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [source, setSource] = useState<'engine' | 'demo'>('demo');
  const barRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLParagraphElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), []);

  const reorder = async () => {
    if (!input.trim() || phase === 'parsing') return;
    setPhase('parsing');
    setOutput('');
    const tokens = input.trim().split(/\s+/);
    const started = performance.now();

    // The real engine when the backend is running; otherwise the local rules, timed the same way.
    let text: string;
    let measured: number;
    try {
      const response = await api.grammar({ rawSpeechTokens: tokens, sourceLang: 'en', targetProfile: 'clearvoice' });
      text = response.formattedText;
      measured = response.executionLatencyMs;
      setSource('engine');
    } catch {
      text = reorderLocally(input);
      measured = Math.max(0.2, performance.now() - started);
      setSource('demo');
    }

    if (barRef.current) {
      animate(barRef.current, { width: ['0%', '100%'], duration: 420, ease: 'outCubic' });
    }
    timer.current = window.setTimeout(() => {
      setOutput(text);
      setLatencyMs(measured);
      setPhase('done');
      if (outputRef.current) {
        animate(outputRef.current, { opacity: [0, 1], scale: [0.96, 1], duration: 380, ease: 'outBack(1.4)' });
      }
    }, 440);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <label htmlFor="clearvoice-input" className="label">
          Speech as it came out
        </label>
        <textarea id="clearvoice-input" value={input} onChange={(event) => setInput(event.target.value)} rows={3} className="field font-mono text-lg" />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setInput(example)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-smoke hover:border-ember/50 hover:text-bone">
              {example}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void reorder()} disabled={phase === 'parsing'} className="btn-primary mt-5">
          <Braces aria-hidden className="size-4" />
          Reorder Syntax
        </button>
      </div>
      <div className="panel p-5">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-smoke">
          <span className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-3.5 text-ember" />
            AST parse
          </span>
          <span className="tabular-nums">{latencyMs === null ? '—' : `${latencyMs.toFixed(2)} ms`} / 10 ms budget</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div ref={barRef} className={`h-full w-0 rounded-full ${phase === 'parsing' ? 'bg-ember-edge' : 'bg-ember/60'}`} />
        </div>
        <p ref={outputRef} className="mt-6 min-h-[3.5rem] font-display text-2xl font-semibold text-bone sm:text-3xl" aria-live="polite">
          {phase === 'done' ? output : phase === 'parsing' ? <span className="text-smoke">Chart-parsing word classes…</span> : <span className="text-smoke/60">Rebuilt sentence appears here.</span>}
        </p>
        <p className="mt-4 text-xs text-smoke">
          {source === 'engine' ? 'Parsed by the real NLTK grammar engine on the local backend.' : 'Local demo rules; start the backend to run the real grammar engine.'}
        </p>
      </div>
    </div>
  );
}
