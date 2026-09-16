'use client';

import { useEffect, useState } from 'react';
import type { BlockEvent, HudFrame, TelemetrySource } from '@/lib/hud/types';

export interface TelemetrySnapshot {
  frame: HudFrame;
  blocks: readonly BlockEvent[];
  blockCount: number;
}

function read(source: TelemetrySource): TelemetrySnapshot {
  return { frame: source.getFrame(), blocks: source.getBlockEvents(), blockCount: source.getBlockCount() };
}

/**
 * Samples the telemetry stream for DOM readouts. Canvases read the source every animation frame;
 * text re-renders at a lower rate so numbers stay legible and React work stays off the hot path.
 */
export function useTelemetrySnapshot(source: TelemetrySource, hz = 12): TelemetrySnapshot {
  const [snapshot, setSnapshot] = useState(() => read(source));

  useEffect(() => {
    setSnapshot(read(source));
    const timer = window.setInterval(() => setSnapshot(read(source)), 1000 / hz);
    return () => window.clearInterval(timer);
  }, [source, hz]);

  return snapshot;
}
