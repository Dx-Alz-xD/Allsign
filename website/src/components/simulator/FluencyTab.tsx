'use client';

import { useEffect, useRef, useState } from 'react';
import { Headphones } from 'lucide-react';

const DAF_MAX_MS = 200;
const FSF_MAX_SEMITONES = 12;
// The drawn "voice": a 120 Hz fundamental shown over a 60 ms window, so one DAF step is visible as a shift.
const VOICE_HZ = 120;
const WINDOW_MS = 60;

export function FluencyTab() {
  const [dafMs, setDafMs] = useState(60);
  const [semitones, setSemitones] = useState(-6);
  const settings = useRef({ dafMs, semitones });
  settings.current = { dafMs, semitones };
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    const start = performance.now();

    const draw = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const { dafMs: delay, semitones: shift } = settings.current;
      const elapsedMs = (performance.now() - start) * 0.25; // slowed down so the wave is readable
      const msPerPixel = WINDOW_MS / width;
      const shiftedHz = VOICE_HZ * Math.pow(2, shift / 12);
      const mid = height / 2;
      const amplitude = height * 0.3;

      // Grid: one line per 10 ms.
      context.strokeStyle = 'rgba(255,255,255,0.06)';
      context.lineWidth = 1;
      for (let ms = 0; ms <= WINDOW_MS; ms += 10) {
        const x = ms / msPerPixel;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }

      const trace = (hz: number, delayMs: number, colour: string, glow: number) => {
        context.beginPath();
        for (let x = 0; x <= width; x++) {
          const t = (x * msPerPixel - delayMs + elapsedMs) / 1000;
          const y = mid - Math.sin(2 * Math.PI * hz * t) * amplitude;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = colour;
        context.lineWidth = 2;
        context.shadowColor = colour;
        context.shadowBlur = glow;
        context.stroke();
        context.shadowBlur = 0;
      };
      trace(VOICE_HZ, 0, 'rgba(154,154,154,0.7)', 0);
      trace(shiftedHz, delay, 'rgba(255,102,0,0.95)', 14);

      // Delay marker.
      if (delay > 0) {
        const x = Math.min(width - 1, delay / msPerPixel);
        context.strokeStyle = 'rgba(255,51,51,0.7)';
        context.setLineDash([4, 4]);
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
        context.setLineDash([]);
      }
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const shiftedHz = VOICE_HZ * Math.pow(2, semitones / 12);

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="panel space-y-6 p-5">
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="daf" className="label mb-0">
              Delayed auditory feedback
            </label>
            <span className="font-mono text-sm tabular-nums text-ember">{dafMs} ms</span>
          </div>
          <input id="daf" type="range" min={0} max={DAF_MAX_MS} step={5} value={dafMs} onChange={(event) => setDafMs(Number(event.target.value))} className="mt-2 w-full" />
          <p className="mt-1 text-xs text-smoke">0 = off. The desktop app supports 30–150 ms; 50–75 ms suits most people who stutter.</p>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="fsf" className="label mb-0">
              Frequency-shifted feedback
            </label>
            <span className="font-mono text-sm tabular-nums text-ember">
              {semitones > 0 ? '+' : ''}
              {semitones} st
            </span>
          </div>
          <input id="fsf" type="range" min={-FSF_MAX_SEMITONES} max={FSF_MAX_SEMITONES} step={1} value={semitones} onChange={(event) => setSemitones(Number(event.target.value))} className="mt-2 w-full" />
          <p className="mt-1 text-xs text-smoke">
            A 120 Hz voice comes back at {shiftedHz.toFixed(1)} Hz. The desktop phase vocoder covers ±6 st (half an octave).
          </p>
        </div>
        <button type="button" onClick={() => (setDafMs(60), setSemitones(-6))} className="btn-secondary w-full justify-center">
          <Headphones aria-hidden className="size-4" />
          Stuttering preset
        </button>
      </div>
      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-smoke">
          <span>60 ms window · grey = your voice · orange = what you hear</span>
          <span className="tabular-nums">wavelength ×{Math.pow(2, -semitones / 12).toFixed(2)}</span>
        </div>
        <canvas ref={canvasRef} aria-label="Feedback waveform" className="mt-3 h-56 w-full rounded-lg bg-black/40" />
      </div>
    </div>
  );
}
