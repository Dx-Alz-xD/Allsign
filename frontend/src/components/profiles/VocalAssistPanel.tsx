'use client';

import { CircleCheck, CircleX, Zap } from 'lucide-react';
import { useSession } from '@/components/providers/SessionProvider';
import { usePolled } from '@/hooks/usePolled';
import { cn } from '@/lib/cn';

const ACTION_LABELS = {
  DIRECT_PASTE: 'typed into the active app',
  TTS_SPOKEN: 'spoken aloud',
  WEBRTC_ALERT: 'sent to the caregiver',
  OS_HOTKEY: 'pressed as a shortcut',
} as const;

/** Live view of the acoustic trigger matcher: best candidate, last match, and what it did. */
export function VocalAssistPanel() {
  const { pipeline, lastMatch, lastAction, live } = useSession();
  const { triggers, snapshotRef } = pipeline;
  const best = usePolled(() => ({ id: snapshotRef.current.triggerBestId, similarity: snapshotRef.current.triggerBestSimilarity }), 8);
  const bestTrigger = triggers.find((trigger) => trigger.id === best.id) ?? null;
  const threshold = bestTrigger?.threshold ?? 0.85;
  const percent = Math.round(best.similarity * 100);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-label="Live match" className="glass flex flex-col gap-4 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-ink">Listening for your sounds</h3>
        {triggers.length === 0 ? (
          <p className="text-mist">No gestures taught yet. Add one below: a hum, a click, a pitch rise.</p>
        ) : (
          <>
            <p className="text-mist">
              {live ? `${triggers.length} trigger${triggers.length === 1 ? '' : 's'} armed.` : 'Start the microphone to arm your triggers.'}
            </p>
            <div role="meter" aria-label="Closest trigger similarity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-mist">{bestTrigger ? `Closest: ${bestTrigger.name}` : 'Closest trigger'}</span>
                <span className="font-display text-xl font-semibold tabular-nums text-ink">{percent}%</span>
              </div>
              <span aria-hidden className="relative mt-2 block h-2 rounded-full bg-white/10">
                <span
                  className={cn('block h-full rounded-full', best.similarity >= threshold ? 'bg-neon-cyan' : 'bg-neon-edge')}
                  style={{ width: `${percent}%`, transition: 'width 120ms linear' }}
                />
                <span className="absolute top-[-3px] h-[14px] w-0.5 bg-warn" style={{ left: `${threshold * 100}%` }} title="Threshold" />
              </span>
              <span className="mt-1 block text-sm text-mist">Fires above {Math.round(threshold * 100)}%.</span>
            </div>
          </>
        )}
      </section>

      <section aria-label="Last trigger" className="glass flex flex-col gap-3 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-ink">Last trigger</h3>
        {lastMatch ? (
          <>
            <p className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
              <Zap aria-hidden className="size-5 text-neon-cyan" />
              {lastMatch.name}
              <span className="text-base font-normal text-mist">{Math.round(lastMatch.similarity * 100)}% match</span>
            </p>
            <p className="text-ink">&ldquo;{lastMatch.mappedPhrase}&rdquo;</p>
            {lastAction && (
              <p className={cn('flex items-start gap-2 text-sm', lastAction.ok ? 'text-mist' : 'text-warn')}>
                {lastAction.ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-neon-cyan" /> : <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />}
                {lastAction.ok ? `Phrase ${ACTION_LABELS[lastAction.action]}.` : lastAction.detail}
              </p>
            )}
            <p className="text-sm text-mist">
              Matched in <span className="tabular-nums">{lastMatch.latencyMs.toFixed(2)} ms</span> of processing.
            </p>
          </>
        ) : (
          <p className="text-mist">Nothing has fired yet.</p>
        )}
      </section>
    </div>
  );
}
