'use client';

import { Activity, Mic, MicOff, Server, Square, TriangleAlert } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { useSession } from '@/components/providers/SessionProvider';
import { cn } from '@/lib/cn';

/** Microphone start/stop, engine state, backend reachability and the latest warning. */
export function SessionBar({ className }: { className?: string }) {
  const { engine, live, startMicrophone, stopMicrophone, backendOnline, warning, pipeline } = useSession();
  const starting = engine.state === 'starting';
  const running = engine.state === 'running';
  const processingMs = live ? pipeline.snapshotRef.current.processingMs : 0;

  return (
    <section aria-label="Live session" className={cn('glass flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3', className)}>
      {running ? (
        <button type="button" onClick={() => void stopMicrophone()} className={buttonStyles.secondary}>
          <Square aria-hidden className="size-4" />
          Stop microphone
        </button>
      ) : (
        <button type="button" onClick={() => void startMicrophone()} disabled={starting} className={buttonStyles.primary}>
          <Mic aria-hidden className="size-4" />
          {starting ? 'Starting' : 'Start microphone'}
        </button>
      )}

      <p className="flex items-center gap-2 text-sm text-mist">
        {running ? <Mic aria-hidden className="size-4 text-neon-cyan" /> : <MicOff aria-hidden className="size-4" />}
        {running
          ? `${engine.inputLabel || 'Microphone'} at ${(engine.sampleRate / 1000).toFixed(1)} kHz, analysed at 16 kHz`
          : engine.state === 'error'
            ? engine.error
            : 'Microphone off. Analysis, feedback and triggers start with it.'}
      </p>

      {live && (
        <p className="flex items-center gap-2 text-sm text-mist">
          <Activity aria-hidden className="size-4 text-neon-blue" />
          DSP <span className="tabular-nums text-ink">{processingMs.toFixed(2)} ms</span> per frame
        </p>
      )}

      <p className="ml-auto flex items-center gap-2 text-sm text-mist">
        <Server aria-hidden className={cn('size-4', backendOnline ? 'text-neon-cyan' : backendOnline === false ? 'text-warn' : '')} />
        {backendOnline === null ? 'Checking backend' : backendOnline ? 'Backend online' : 'Backend unreachable: grammar, triggers and sessions are paused'}
      </p>

      {warning && (
        <p role="status" className="flex w-full items-start gap-2 text-sm text-warn">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {warning}
        </p>
      )}
    </section>
  );
}
