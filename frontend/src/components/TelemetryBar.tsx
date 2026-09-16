'use client';

import { useId, type ReactNode } from 'react';
import { CircleCheck, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import { useTelemetrySnapshot } from '@/hooks/useTelemetrySnapshot';
import type { PeerLinkState, TelemetrySource } from '@/lib/hud/types';
import { cn } from '@/lib/cn';

export const LATENCY_TARGET_MS = 15;
const LATENCY_SCALE_MS = 20;
const WPM_MAX = 200;
const DB_MIN = -60;
const CLIP_WARNING_DB = -6;
const METER_SEGMENTS = 24;

interface TelemetryBarProps {
  source: TelemetrySource;
  peer: PeerLinkState;
  /** GrammarResponse.executionLatencyMs from the most recent parse. */
  parseLatencyMs?: number | null;
  /** The grammar engine's parse budget (backend LATENCY_BUDGET_MS). */
  parseTargetMs?: number;
  className?: string;
}

export function TelemetryBar({ source, peer, parseLatencyMs = null, parseTargetMs = LATENCY_TARGET_MS, className }: TelemetryBarProps) {
  const { frame, blockCount } = useTelemetrySnapshot(source);
  const { fluency, telemetry } = frame;

  return (
    <section
      aria-label="Live telemetry"
      className={cn(
        'grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5',
        className,
      )}
    >
      <Cell title="Speaking rate">
        <WpmGauge wpm={fluency.wpm} />
      </Cell>
      <Cell title="Vocal blocks">
        <BlockIndicator active={fluency.vocalBlockDetected} durationMs={fluency.blockDurationMs} count={blockCount} />
      </Cell>
      <Cell title="Latency">
        <div className="flex flex-col gap-3">
          <LatencyCounter label="Audio processing" ms={frame.latencyMs} targetMs={LATENCY_TARGET_MS} />
          <LatencyCounter label="Grammar parsing" ms={parseLatencyMs} targetMs={parseTargetMs} />
        </div>
      </Cell>
      <Cell title="Volume">
        <VolumeMeter db={telemetry.volumeDb} />
      </Cell>
      <Cell title="Caregiver link" className="sm:col-span-2 lg:col-span-2 2xl:col-span-1">
        <PeerStatus peer={peer} />
      </Cell>
    </section>
  );
}

function Cell({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className={cn('flex min-w-0 flex-col gap-3 bg-panel p-4', className)}>
      <p id={titleId} className="text-sm font-bold text-mist">
        {title}
      </p>
      {children}
    </div>
  );
}

function WpmGauge({ wpm }: { wpm: number }) {
  const gradientId = `wpm-${useId().replace(/:/g, '')}`;
  const value = Math.round(Math.max(0, Math.min(WPM_MAX, wpm)));
  const arc = 'M 8 48 A 40 40 0 0 1 88 48';

  return (
    <div
      role="meter"
      aria-label="Speaking rate"
      aria-valuemin={0}
      aria-valuemax={WPM_MAX}
      aria-valuenow={value}
      aria-valuetext={`${value} words per minute`}
      className="flex items-end gap-3"
    >
      <svg aria-hidden viewBox="0 0 96 54" className="h-14 w-[6.25rem] shrink-0">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#00F2FE" />
            <stop offset="100%" stopColor="#4FACFE" />
          </linearGradient>
        </defs>
        <path d={arc} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="8"
          strokeLinecap="round"
          pathLength={1}
          style={{ strokeDasharray: `${value / WPM_MAX} 1`, transition: 'stroke-dasharray 120ms linear' }}
        />
      </svg>
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-3xl font-bold tabular-nums text-ink">{value}</span>
        <span className="text-sm text-mist">WPM</span>
      </p>
    </div>
  );
}

function BlockIndicator({ active, durationMs, count }: { active: boolean; durationMs: number; count: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
        active ? 'border-warn/60 bg-warn/10' : 'border-white/10 bg-white/[0.03]',
      )}
    >
      {active ? (
        <TriangleAlert aria-hidden className="size-6 shrink-0 text-warn" />
      ) : (
        <CircleCheck aria-hidden className="size-6 shrink-0 text-dim" />
      )}
      <div className="min-w-0">
        <p className="flex items-baseline gap-2 font-display text-lg font-semibold">
          <span aria-live="polite" className={active ? 'text-warn' : 'text-ink'}>
            {active ? 'Block detected' : 'No block'}
          </span>
          {active && <span className="text-base tabular-nums text-warn">{(durationMs / 1000).toFixed(1)} s</span>}
        </p>
        <p className="text-sm text-mist">{count === 1 ? '1 this session' : `${count} this session`}</p>
      </div>
    </div>
  );
}

function LatencyCounter({ label, ms, targetMs }: { label: string; ms: number | null; targetMs: number }) {
  const known = ms !== null && ms > 0;
  const over = known && ms > targetMs;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-mist">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className={cn('font-display text-xl font-semibold tabular-nums', over ? 'text-warn' : 'text-ink')}>
            {known ? ms.toFixed(1) : '—'}
          </span>
          <span className="text-sm text-mist">ms</span>
          {known &&
            (over ? (
              <TriangleAlert aria-hidden className="size-4 text-warn" />
            ) : (
              <CircleCheck aria-hidden className="size-4 text-neon-cyan" />
            ))}
          {known && <span className="sr-only">{over ? `over the ${targetMs} ms target` : `within the ${targetMs} ms target`}</span>}
        </span>
      </div>
      <div aria-hidden className="relative mt-1.5 h-1.5 rounded-full bg-white/10">
        <div
          className={cn('h-full rounded-full', over ? 'bg-warn' : 'bg-neon-edge')}
          style={{ width: `${known ? Math.min(100, (ms / LATENCY_SCALE_MS) * 100) : 0}%` }}
        />
        <div
          className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink/70"
          style={{ left: `${(Math.min(targetMs, LATENCY_SCALE_MS) / LATENCY_SCALE_MS) * 100}%` }}
        />
      </div>
    </div>
  );
}

function meterSegmentColor(index: number): string {
  const t = index / (METER_SEGMENTS - 1);
  const mix = (from: number, to: number) => Math.round(from + (to - from) * t);
  return `rgb(${mix(0x00, 0x4f)}, ${mix(0xf2, 0xac)}, ${mix(0xfe, 0xfe)})`;
}

function VolumeMeter({ db }: { db: number }) {
  const value = Math.max(DB_MIN, Math.min(0, db));
  const rounded = Math.round(value);
  const lit = Math.round(((value - DB_MIN) / -DB_MIN) * METER_SEGMENTS);

  return (
    <div
      role="meter"
      aria-label="Volume"
      aria-valuemin={DB_MIN}
      aria-valuemax={0}
      aria-valuenow={rounded}
      aria-valuetext={`${rounded} decibels`}
    >
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-3xl font-bold tabular-nums text-ink">
          {rounded < 0 ? `−${Math.abs(rounded)}` : '0'}
        </span>
        <span className="text-sm text-mist">dBFS</span>
      </p>
      <div aria-hidden className="mt-2 flex h-3 gap-[3px]">
        {Array.from({ length: METER_SEGMENTS }, (_, index) => {
          const segmentTopDb = DB_MIN + ((index + 1) / METER_SEGMENTS) * -DB_MIN;
          const on = index < lit;
          const hot = segmentTopDb > CLIP_WARNING_DB;
          return (
            <span
              key={index}
              className={cn('flex-1 rounded-[2px]', !on && 'bg-white/10', on && hot && 'bg-warn')}
              style={on && !hot ? { backgroundColor: meterSegmentColor(index) } : undefined}
            />
          );
        })}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-xs text-dim">
        <span>−60</span>
        <span>−30</span>
        <span>0</span>
      </div>
    </div>
  );
}

function PeerStatus({ peer }: { peer: PeerLinkState }) {
  const connected = peer.status === 'connected';
  const connecting = peer.status === 'connecting';
  const title = connected ? 'Connected' : connecting ? 'Connecting' : 'Not connected';
  const detail = connected
    ? `${peer.peerLabel}, ${peer.roundTripMs ?? '—'} ms round trip`
    : connecting
      ? `Reaching ${peer.peerLabel}`
      : 'No WebRTC peer';

  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-xl ring-1',
          connected ? 'bg-neon-cyan/10 text-neon-cyan ring-neon-cyan/40' : 'bg-white/5 text-dim ring-white/10',
          connecting && 'motion-safe:animate-pulse',
        )}
      >
        {connected || connecting ? <Wifi aria-hidden className="size-5" /> : <WifiOff aria-hidden className="size-5" />}
      </span>
      <div className="min-w-0">
        <p aria-live="polite" className="font-display text-lg font-semibold text-ink">
          {title}
        </p>
        <p className="truncate text-sm tabular-nums text-mist">{detail}</p>
      </div>
    </div>
  );
}
