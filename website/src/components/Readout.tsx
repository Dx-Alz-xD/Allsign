'use client';

import { useEffect, useRef } from 'react';
import { countUpOnScroll } from '@/lib/motion';

interface Reading {
  value: number;
  format: (value: number) => string;
  label: string;
  detail: string;
}

// Numbers the desktop app is built on (simulate_dsp_delay at 48 kHz, the 256-point FFT, the 160-sample hop).
const READINGS: Reading[] = [
  { value: 4.9, format: (v) => `${v.toFixed(1)} ms`, label: 'microphone to analysis', detail: 'at 48 kHz, before the 10 ms frame is even full' },
  { value: 128, format: (v) => `${Math.round(v)}`, label: 'spectral bins per frame', detail: '62.5 Hz each, the fingerprint of every trigger' },
  { value: 10, format: (v) => `${Math.round(v)} ms`, label: 'between readings', detail: 'pitch, formants, strain and blocks refresh 100 times a second' },
  { value: 0, format: () => '0 B', label: 'of audio uploaded', detail: 'the microphone never reaches a server' },
];

/** An instrument strip: the figures count up the first time they scroll into view. */
export function Readout() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current;
    if (!section) return;
    const runs = Array.from(section.querySelectorAll<HTMLElement>('[data-reading]')).map((element, index) =>
      countUpOnScroll(element, READINGS[index].value, READINGS[index].format),
    );
    return () => runs.forEach((run) => run?.revert());
  }, []);

  return (
    <section ref={root} aria-label="Key figures" className="mx-auto max-w-6xl px-6">
      <dl className="readout grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
        {READINGS.map((reading) => (
          <div key={reading.label} className="bg-obsidian px-6 py-6">
            <dd data-reading className="font-display text-4xl font-bold tabular-nums text-bone">
              {reading.format(reading.value)}
            </dd>
            <dt className="mt-1 text-sm font-semibold text-ember">{reading.label}</dt>
            <p className="mt-2 text-sm text-smoke">{reading.detail}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}
