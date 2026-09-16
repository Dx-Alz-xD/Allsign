'use client';

import { HeartPulse, TriangleAlert } from 'lucide-react';
import { HUDCanvas } from '@/components/HUDCanvas';
import { useSession } from '@/components/providers/SessionProvider';
import { usePolled } from '@/hooks/usePolled';
import { cn } from '@/lib/cn';

const LEVEL_LABELS = { normal: 'Comfortable', caution: 'Getting tired', warning: 'Rest your voice' } as const;

/** Volume, pitch and strain as large visual cues, with the fatigue state from the biomarker worker. */
export function SensoryPanel() {
  const { telemetry, pipeline, live } = useSession();
  const { snapshotRef } = pipeline;
  const state = usePolled(
    () => ({
      volumeDb: Math.round(snapshotRef.current.volumeDb),
      pitchHz: snapshotRef.current.voiced ? Math.round(snapshotRef.current.pitchHz) : 0,
      strain: Math.round(snapshotRef.current.strainSmoothed),
      level: snapshotRef.current.strainLevel,
      warning: snapshotRef.current.fatigueWarning,
      phonation: Math.round(snapshotRef.current.phonationSeconds),
      trend: Math.round(snapshotRef.current.trendPerMinute),
      hnr: snapshotRef.current.hnrDb,
      ready: snapshotRef.current.biomarkersReady,
    }),
    6,
  );
  const volumePercent = Math.max(0, Math.min(100, ((state.volumeDb + 60) / 60) * 100));

  return (
    <div className="flex flex-col gap-4">
      {state.warning && (
        <p role="alert" className="flex items-center gap-3 rounded-2xl border border-warn/60 bg-warn/10 px-5 py-4 font-display text-xl font-semibold text-warn">
          <TriangleAlert aria-hidden className="size-6 shrink-0" />
          Your voice shows signs of strain. Take a break, sip water, and speak softly for a while.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Cue label="Volume" value={live ? `${state.volumeDb} dB` : '—'} percent={live ? volumePercent : 0} />
        <Cue label="Pitch" value={state.pitchHz > 0 ? `${state.pitchHz} Hz` : 'no voice'} percent={state.pitchHz > 0 ? Math.min(100, (state.pitchHz / 400) * 100) : 0} />
        <Cue
          label="Vocal strain"
          value={state.ready ? `${state.strain} of 100` : '—'}
          percent={state.ready ? state.strain : 0}
          tone={state.level === 'warning' ? 'warn' : state.level === 'caution' ? 'caution' : 'ok'}
          detail={state.ready ? LEVEL_LABELS[state.level] : 'Measures after a few seconds of speech'}
        />
      </div>

      <section aria-label="Sound picture" className="glass rounded-2xl p-5">
        <HUDCanvas source={telemetry} layers={['waveform', 'spectrum']} label="Live waveform above a 128-bin spectral energy chart" canvasClassName="h-64" />
      </section>

      <section aria-label="Voice use" className="glass flex flex-wrap items-center gap-6 rounded-2xl px-5 py-4 text-mist">
        <span className="flex items-center gap-2">
          <HeartPulse aria-hidden className="size-5 text-neon-blue" />
          Talking time <span className="font-display text-lg font-semibold tabular-nums text-ink">{Math.floor(state.phonation / 60)}m {state.phonation % 60}s</span>
        </span>
        <span>
          Strain trend <span className={cn('font-display text-lg font-semibold tabular-nums', state.trend > 5 ? 'text-warn' : 'text-ink')}>{state.trend > 0 ? '+' : ''}{state.trend}</span> per minute
        </span>
        <span>
          Breathiness <span className="font-display text-lg font-semibold tabular-nums text-ink">{state.ready ? `${state.hnr.toFixed(0)} dB HNR` : '—'}</span>
        </span>
      </section>
    </div>
  );
}

function Cue({ label, value, percent, tone = 'ok', detail }: { label: string; value: string; percent: number; tone?: 'ok' | 'caution' | 'warn'; detail?: string }) {
  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-5">
      <p className="text-sm font-bold text-mist">{label}</p>
      <p className="font-display text-4xl font-semibold tabular-nums text-ink">{value}</p>
      <span aria-hidden className="block h-3 rounded-full bg-white/10">
        <span
          className={cn('block h-full rounded-full', tone === 'warn' ? 'bg-warn' : tone === 'caution' ? 'bg-[#FFD166]' : 'bg-neon-edge')}
          style={{ width: `${percent}%`, transition: 'width 150ms linear' }}
        />
      </span>
      {detail && <p className="text-sm text-mist">{detail}</p>}
    </div>
  );
}
