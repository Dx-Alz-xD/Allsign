'use client';

/**
 * Floating chat widget for the Voicematics Onboarding Assistant.
 *
 * It talks to POST /api/agent/chat on the local backend, which runs the assistant with two deterministic
 * tools (simulate_dsp_delay, recommend_settings) on Gemini, falling back to Groq. The tool calls the
 * assistant made are shown under its reply so the numbers can be traced.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { animate } from 'animejs';
import { Bot, Loader2, MessageSquare, Send, Wrench, X } from 'lucide-react';
import type { AgentStatus, ChatMessage, ToolCallRecord } from '@shared/types';
import { ApiError, api } from '@/lib/api';

interface Turn extends ChatMessage {
  id: number;
  toolCalls?: ToolCallRecord[];
  modelName?: string;
}

const WELCOME =
  'Hi, I am the Voicematics Onboarding Assistant. Ask me how the on-device pipeline keeps your audio private, what latency to expect at your microphone rate, or where to start with DAF and pitch-shift settings.';
const SUGGESTIONS = ['Is any audio sent to the cloud?', 'What latency do I get at 48 kHz?', 'Starting settings for stuttering?'];
const MAX_HISTORY = 20;

function describeTool(call: ToolCallRecord): string {
  const args = Object.entries(call.args)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
  const result = call.result as Record<string, unknown> | null;
  if (call.name === 'simulate_dsp_delay' && result) {
    return `simulate_dsp_delay(${args}) → ${result.worstCaseMs} ms worst case, ${result.withinBudget ? 'under' : 'over'} the ${result.budgetMs} ms budget`;
  }
  if (call.name === 'recommend_settings' && result) {
    return `recommend_settings(${args}) → DAF ${result.dafDelayMs} ms, pitch ${result.pitchShiftSemitones} st`;
  }
  return `${call.name}(${args})`;
}

export function AgentAssistant() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([{ id: 0, role: 'assistant', content: WELCOME }]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    api.agent
      .status()
      .then(setStatus)
      .catch(() => setStatus({ available: false, providers: [], primary: null }));
  }, []);

  useEffect(() => {
    if (open && panelRef.current) animate(panelRef.current, { opacity: [0, 1], y: [16, 0], scale: [0.96, 1], duration: 320, ease: 'outCubic' });
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      setError(null);
      setDraft('');
      const userTurn: Turn = { id: nextId.current++, role: 'user', content };
      const history = [...turns, userTurn];
      setTurns(history);
      setBusy(true);
      try {
        const messages = history.slice(-MAX_HISTORY).map(({ role, content: body }) => ({ role, content: body }));
        // The welcome line is the widget's, not the model's; drop it when it leads the history.
        const response = await api.agent.chat({ messages: messages[0]?.content === WELCOME ? messages.slice(1) : messages });
        setTurns((current) => [...current, { id: nextId.current++, role: 'assistant', content: response.reply, toolCalls: response.toolCalls, modelName: response.modelName }]);
      } catch (failure) {
        const message = failure instanceof ApiError && failure.status === 429 ? 'The assistant is rate limited; try again in a minute.' : failure instanceof Error ? failure.message : String(failure);
        setError(message);
      } finally {
        setBusy(false);
      }
    },
    [busy, turns],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const unavailable = status !== null && !status.available;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Voicematics Onboarding Assistant" className="flex h-[32rem] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-crimson/40 bg-obsidian shadow-ember">
          <header className="flex items-center gap-3 border-b border-white/10 bg-onyx px-4 py-3">
            <span className="grid size-9 place-items-center rounded-xl bg-crimson/15 ring-1 ring-crimson/60">
              <Bot aria-hidden className="size-5 text-crimson" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold text-bone">Onboarding Assistant</p>
              <p className="truncate text-xs text-smoke">
                {status === null ? 'Checking…' : status.available ? `${status.primary === 'gemini' ? 'Gemini' : 'Groq'}${status.providers.length > 1 ? ', Groq fallback' : ''} · never hears your microphone` : 'Offline'}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-lg p-1 text-smoke hover:bg-white/10 hover:text-bone">
              <X aria-hidden className="size-4" />
            </button>
          </header>

          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {turns.map((turn) => (
              <div key={turn.id} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${turn.role === 'user' ? 'bg-crimson/20 text-bone' : 'bg-white/[0.06] text-bone'}`}>
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                  {turn.toolCalls && turn.toolCalls.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
                      {turn.toolCalls.map((call, index) => (
                        <li key={index} className="flex items-start gap-1.5 font-mono text-[11px] text-ember">
                          <Wrench aria-hidden className="mt-0.5 size-3 shrink-0" />
                          {describeTool(call)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-smoke">
                <Loader2 aria-hidden className="size-3.5 animate-spin text-crimson" />
                Thinking…
              </div>
            )}
            {error && <p className="text-xs text-crimson">{error}</p>}
            {unavailable && <p className="rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-smoke">The assistant needs a model key on the backend: set GEMINI_API_KEY (or GROQ_API_KEY as the fallback) in backend/.env and restart it.</p>}
          </div>

          {turns.length === 1 && !unavailable && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void send(suggestion)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-smoke hover:border-crimson/60 hover:text-bone">
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/10 bg-onyx px-3 py-3">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={unavailable ? 'Assistant offline' : 'Ask about settings or privacy…'}
              aria-label="Message the assistant"
              disabled={busy || unavailable}
              maxLength={4000}
              className="field py-2"
            />
            <button type="submit" disabled={busy || unavailable || !draft.trim()} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-xl bg-ember-edge text-obsidian disabled:opacity-40">
              <Send aria-hidden className="size-4" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Hide the onboarding assistant' : 'Open the onboarding assistant'}
        className="flex items-center gap-2 rounded-full border border-crimson/50 bg-obsidian px-4 py-3 font-display text-sm font-semibold text-bone shadow-ember transition hover:bg-onyx"
      >
        <MessageSquare aria-hidden className="size-4 text-crimson" />
        {open ? 'Close' : 'Ask the assistant'}
        {status?.available && <span className="size-2 rounded-full bg-ember shadow-[0_0_8px_#FF6600]" aria-hidden />}
      </button>
    </div>
  );
}
