'use client';

import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FlaskConical, Send } from 'lucide-react';
import type { GrammarResponse } from '@shared/types';
import { HUDCanvas, type HudLayer } from '@/components/HUDCanvas';
import type { GrammarSource } from '@/components/providers/SessionProvider';
import { SignOverlay, SignStrip, useSignPlayback } from '@/components/signs/SignSequence';
import { TelemetryBar } from '@/components/TelemetryBar';
import { SyntaxTree, TextReconstruction } from '@/components/ui/Reconstruction';
import { useTelemetrySnapshot } from '@/hooks/useTelemetrySnapshot';
import type { BlockEvent, HudFrame, PeerLinkState, TelemetrySource } from '@/lib/hud/types';
import { cn } from '@/lib/cn';

const SPECTROGRAM_LAYERS: readonly HudLayer[] = ['spectrogram'];
const SIGNAL_LAYERS: readonly HudLayer[] = ['waveform', 'spectrum'];
const BREATHING_LAYERS: readonly HudLayer[] = ['breathing'];
const MAX_ALERTS_SHOWN = 4;

interface PitchModeDashboardProps {
  source: TelemetrySource;
  peer: PeerLinkState;
  grammar: GrammarResponse | null;
  grammarSource?: GrammarSource | null;
  /** speech.worker request start to parsed response, for `grammar`. */
  grammarRoundTripMs?: number | null;
  /** The grammar engine's parse budget. */
  astBudgetMs?: number;
  /** Shows a notice that the data comes from the built-in simulated signal. */
  isSimulated?: boolean;
}

export function PitchModeDashboard({
  source,
  peer,
  grammar,
  grammarSource = null,
  grammarRoundTripMs = null,
  astBudgetMs = 10,
  isSimulated = false,
}: PitchModeDashboardProps) {
  const { frame, blocks, blockCount } = useTelemetrySnapshot(source, 8);
  const signs = useSignPlayback(grammar?.formattedText ?? null, frame.fluency.wpm);

  return (
    <div className="space-y-4">
      {isSimulated && (
        <p className="flex items-start gap-2 text-sm text-mist">
          <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
          Showing a built-in simulated signal until the audio engine and caregiver link are connected.
        </p>
      )}

      <TelemetryBar
        source={source}
        peer={peer}
        parseLatencyMs={grammarSource === 'simulated' ? null : (grammar?.executionLatencyMs ?? null)}
        parseTargetMs={astBudgetMs}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <Column title="Audio spectrogram and DSP">
          <div className="relative">
            <HUDCanvas
              source={source}
              layers={SPECTROGRAM_LAYERS}
              label="Scrolling spectrogram of the last few seconds of audio, low frequencies at the bottom"
              canvasClassName="h-52"
            />
            <SignOverlay playback={signs} className="absolute right-2 top-2" />
          </div>
          <HUDCanvas
            source={source}
            layers={SIGNAL_LAYERS}
            label="Live waveform above a 128-bin spectral energy chart"
            canvasClassName="h-60"
          />
          <DspReadouts frame={frame} />
        </Column>

        <Column title="Live text reconstruction">
          <TextReconstruction
            grammar={grammar}
            roundTripMs={grammarRoundTripMs}
            budgetMs={astBudgetMs}
            source={grammarSource}
          />
          <SignStrip playback={signs} />
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-ink">Breathing guide</h3>
            <HUDCanvas
              source={source}
              layers={BREATHING_LAYERS}
              label="Breathing guide wave with your voice volume traced over it"
              canvasClassName="h-44"
            />
          </div>
        </Column>

        <Column title="Caregiver telemetry">
          <CaregiverPanel peer={peer} frame={frame} blocks={blocks} blockCount={blockCount} />
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-ink">Syntax tree</h3>
            {grammar ? (
              <SyntaxTree tree={grammar.parsedTree} />
            ) : (
              <p className="text-mist">The tree appears after the first sentence is parsed.</p>
            )}
          </div>
        </Column>
      </div>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="glass flex min-w-0 flex-col gap-6 rounded-2xl p-4 sm:p-5">
      <h2 id={headingId} className="text-xl font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* Left column ------------------------------------------------------------ */

function DspReadouts({ frame }: { frame: HudFrame }) {
  const { telemetry, fluency } = frame;
  const voiced = telemetry.pitchHz > 0;
  const unvoiced = '—';

  const readouts: ReadonlyArray<[label: string, value: string, unit: string]> = [
    ['Pitch', voiced ? telemetry.pitchHz.toFixed(0) : unvoiced, 'Hz'],
    ['Pitch volatility', voiced ? fluency.pitchVolatilityHz.toFixed(1) : unvoiced, 'Hz'],
    ['Jitter', voiced ? telemetry.jitterPercent.toFixed(2) : unvoiced, '%'],
    ['Shimmer', voiced ? telemetry.shimmerDb.toFixed(2) : unvoiced, 'dB'],
    ['Harmonics to noise', voiced ? telemetry.hnrDb.toFixed(1) : unvoiced, 'dB'],
    ['Vocal strain', telemetry.vocalStrainIndex.toFixed(0), 'of 100'],
  ];

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-ink">Voice measures</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10">
        {readouts.map(([label, value, unit]) => (
          <div key={label} className="bg-panel px-3 py-2.5">
            <dt className="text-sm text-mist">{label}</dt>
            <dd className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-display text-xl font-semibold tabular-nums text-ink">{value}</span>
              {value !== unvoiced && <span className="text-sm text-mist">{unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {!voiced && <p className="text-sm text-mist">No voicing right now, so pitch-based measures are paused.</p>}
    </div>
  );
}

/* Center column ---------------------------------------------------------- */

/* Right column ----------------------------------------------------------- */

function formatAgo(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

function CaregiverPanel({
  peer,
  frame,
  blocks,
  blockCount,
}: {
  peer: PeerLinkState;
  frame: HudFrame;
  blocks: readonly BlockEvent[];
  blockCount: number;
}) {
  const connected = peer.status === 'connected';
  const strain = Math.round(Math.max(0, Math.min(100, frame.telemetry.vocalStrainIndex)));
  const recent = blocks.slice(0, MAX_ALERTS_SHOWN);

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10">
        <div className="col-span-2 bg-panel px-3 py-2.5">
          <dt className="text-sm text-mist">Sharing with</dt>
          <dd className="mt-0.5 font-display text-lg font-semibold text-ink">
            {peer.peerLabel}
            <span className="ml-2 text-base font-normal text-mist">
              {connected ? `${peer.roundTripMs ?? '—'} ms round trip` : peer.status === 'connecting' ? 'connecting' : 'offline'}
            </span>
          </dd>
        </div>
        <div className="bg-panel px-3 py-2.5">
          <dt className="text-sm text-mist">Speaking rate</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">
            {Math.round(frame.fluency.wpm)} <span className="text-sm font-normal text-mist">WPM</span>
          </dd>
        </div>
        <div className="bg-panel px-3 py-2.5">
          <dt className="text-sm text-mist">Blocks this session</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">{blockCount}</dd>
        </div>
        <div className="col-span-2 bg-panel px-3 py-2.5">
          <dt className="text-sm text-mist">Vocal strain</dt>
          <dd className="mt-0.5">
            <span className="font-display text-xl font-semibold tabular-nums text-ink">
              {strain} <span className="text-sm font-normal text-mist">of 100</span>
            </span>
            <span aria-hidden className="mt-2 block h-2 rounded-full bg-white/10">
              <span
                className={cn('block h-full rounded-full', strain >= 60 ? 'bg-warn' : 'bg-neon-edge')}
                style={{ width: `${strain}%`, transition: 'width 150ms linear' }}
              />
            </span>
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2.5">
        <h3 className="text-base font-semibold text-ink">Alerts sent</h3>
        {recent.length === 0 ? (
          <p className="text-mist">No alerts yet. Vocal blocks are shared with the caregiver as they happen.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((block) => (
              <li
                key={block.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-3 py-2',
                  block.ongoing ? 'border-warn/60 bg-warn/10' : 'border-white/10 bg-white/[0.03]',
                )}
              >
                <Send aria-hidden className={cn('size-4 shrink-0', block.ongoing ? 'text-warn' : 'text-neon-blue')} />
                <span className="min-w-0 flex-1 text-ink">
                  Vocal block, <span className="tabular-nums">{(block.durationMs / 1000).toFixed(1)} s</span>
                  {block.ongoing && <span className="text-warn"> and ongoing</span>}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-mist">
                  {connected ? formatAgo(block.startedAt) : 'Queued'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
