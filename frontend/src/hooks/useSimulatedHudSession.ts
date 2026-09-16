'use client';

import { useEffect, useState } from 'react';
import type { GrammarResponse } from '@shared/types';
import { simulatedGrammarAt, simulatedPeerAt, startSimulatedAudio } from '@/lib/hud/simulated';
import { createTelemetryStore } from '@/lib/hud/store';
import type { PeerLinkState, TelemetrySource } from '@/lib/hud/types';

export interface HudSession {
  source: TelemetrySource;
  peer: PeerLinkState;
  grammar: GrammarResponse;
  isSimulated: boolean;
}

/** Wires the HUD to the deterministic simulated signal. Swap for the DSP worker session when it exists. */
export function useSimulatedHudSession(): HudSession {
  const [store] = useState(createTelemetryStore);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => startSimulatedAudio(store), [store]);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds((Date.now() - startedAt) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return {
    source: store,
    peer: simulatedPeerAt(elapsedSeconds),
    grammar: simulatedGrammarAt(elapsedSeconds),
    isSimulated: true,
  };
}
