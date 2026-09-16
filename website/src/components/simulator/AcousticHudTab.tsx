'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Crosshair } from 'lucide-react';

interface Vowel {
  symbol: string;
  word: string;
  f1: number;
  f2: number;
}

// Adult reference formants (Hz); the three the demo animates between plus two neighbours for context.
const VOWELS: Vowel[] = [
  { symbol: '/i/', word: 'beet', f1: 270, f2: 2290 },
  { symbol: '/æ/', word: 'bat', f1: 660, f2: 1720 },
  { symbol: '/a/', word: 'father', f1: 730, f2: 1090 },
  { symbol: '/ɔ/', word: 'bought', f1: 570, f2: 840 },
  { symbol: '/u/', word: 'boot', f1: 300, f2: 870 },
];
const PRESETS = ['/i/', '/u/', '/a/'];
const F1_RANGE: [number, number] = [200, 900];
const F2_RANGE: [number, number] = [600, 2600];
const ZONE_RADIUS_HZ = { f1: 70, f2: 180 };
const ACCURACY_RADIUS_HZ = 420;

export function AcousticHudTab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const position = useRef({ f1: 500, f2: 1500 });
  const wobble = useRef({ f1: 0, f2: 0 });
  const [target, setTarget] = useState<Vowel>(VOWELS[0]);
  const [accuracy, setAccuracy] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    // Small formant wobble, like a held vowel.
    const drift = animate(wobble.current, {
      f1: [{ to: 14, duration: 900 }, { to: -12, duration: 1100 }, { to: 0, duration: 800 }],
      f2: [{ to: -30, duration: 1300 }, { to: 24, duration: 900 }, { to: 0, duration: 1000 }],
      ease: 'inOutSine',
      loop: true,
    });
    return () => {
      drift.revert();
    };
  }, []);

  useEffect(() => {
    const move = animate(position.current, { f1: target.f1, f2: target.f2, duration: 900, ease: 'outElastic(1, .7)' });
    return () => {
      move.pause();
    };
  }, [target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    const trail: Array<{ x: number; y: number }> = [];

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
      const pad = { left: 44, right: 14, top: 14, bottom: 30 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      // F2 runs right-to-left (front vowels on the left), F1 top-to-bottom (close vowels at the top).
      const x = (f2: number) => pad.left + ((F2_RANGE[1] - f2) / (F2_RANGE[1] - F2_RANGE[0])) * plotW;
      const y = (f1: number) => pad.top + ((f1 - F1_RANGE[0]) / (F1_RANGE[1] - F1_RANGE[0])) * plotH;

      context.strokeStyle = 'rgba(255,255,255,0.07)';
      context.fillStyle = 'rgba(154,154,154,0.8)';
      context.font = '10px ui-monospace, monospace';
      context.lineWidth = 1;
      for (let f1 = F1_RANGE[0]; f1 <= F1_RANGE[1]; f1 += 100) {
        context.beginPath();
        context.moveTo(pad.left, y(f1));
        context.lineTo(width - pad.right, y(f1));
        context.stroke();
        context.fillText(`${f1}`, 6, y(f1) + 3);
      }
      for (let f2 = F2_RANGE[0]; f2 <= F2_RANGE[1]; f2 += 400) {
        context.beginPath();
        context.moveTo(x(f2), pad.top);
        context.lineTo(x(f2), height - pad.bottom);
        context.stroke();
        context.fillText(`${f2}`, x(f2) - 10, height - 12);
      }
      context.fillText('F1 Hz', 6, 10);
      context.fillText('F2 Hz', width - 44, height - 2);

      // The quadrilateral: i -> æ -> a -> ɔ -> u.
      const corners = ['/i/', '/æ/', '/a/', '/ɔ/', '/u/'].map((symbol) => VOWELS.find((vowel) => vowel.symbol === symbol)!);
      context.beginPath();
      corners.forEach((vowel, index) => (index === 0 ? context.moveTo(x(vowel.f2), y(vowel.f1)) : context.lineTo(x(vowel.f2), y(vowel.f1))));
      context.closePath();
      context.strokeStyle = 'rgba(255,102,0,0.35)';
      context.fillStyle = 'rgba(255,102,0,0.04)';
      context.fill();
      context.stroke();

      const current = targetRef.current;
      for (const vowel of VOWELS) {
        const isTarget = vowel.symbol === current.symbol;
        context.beginPath();
        context.ellipse(x(vowel.f2), y(vowel.f1), (ZONE_RADIUS_HZ.f2 / (F2_RANGE[1] - F2_RANGE[0])) * plotW, (ZONE_RADIUS_HZ.f1 / (F1_RANGE[1] - F1_RANGE[0])) * plotH, 0, 0, Math.PI * 2);
        context.fillStyle = isTarget ? 'rgba(255,51,51,0.18)' : 'rgba(255,255,255,0.04)';
        context.strokeStyle = isTarget ? 'rgba(255,51,51,0.8)' : 'rgba(255,255,255,0.15)';
        context.fill();
        context.stroke();
        context.fillStyle = isTarget ? '#FF6600' : 'rgba(242,237,230,0.7)';
        context.font = isTarget ? 'bold 13px ui-monospace, monospace' : '12px ui-monospace, monospace';
        context.fillText(vowel.symbol, x(vowel.f2) - 9, y(vowel.f1) - 12);
      }

      const f1 = position.current.f1 + wobble.current.f1;
      const f2 = position.current.f2 + wobble.current.f2;
      const px = x(f2);
      const py = y(f1);
      trail.push({ x: px, y: py });
      if (trail.length > 28) trail.shift();
      trail.forEach((point, index) => {
        context.beginPath();
        context.arc(point.x, point.y, 2 + (index / trail.length) * 3, 0, Math.PI * 2);
        context.fillStyle = `rgba(255,102,0,${(index / trail.length) * 0.35})`;
        context.fill();
      });
      context.beginPath();
      context.arc(px, py, 7, 0, Math.PI * 2);
      context.fillStyle = '#FF3333';
      context.shadowColor = '#FF3333';
      context.shadowBlur = 18;
      context.fill();
      context.shadowBlur = 0;

      const distance = Math.hypot(f1 - current.f1, f2 - current.f2);
      setAccuracy(Math.max(0, Math.min(100, 100 * (1 - distance / ACCURACY_RADIUS_HZ))));
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="panel p-5">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-smoke">
          <span className="flex items-center gap-2">
            <Crosshair aria-hidden className="size-3.5 text-ember" />
            F1 / F2 vowel quadrilateral
          </span>
          <span className="tabular-nums">LPC order 18 · 30 fps</span>
        </div>
        <canvas ref={canvasRef} aria-label="Vowel plane with the tracked formant position" className="mt-3 h-72 w-full rounded-lg bg-black/40" />
      </div>
      <div className="panel flex flex-col gap-4 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-smoke">Target phoneme</p>
          <div className="mt-2 flex gap-2">
            {PRESETS.map((symbol) => {
              const vowel = VOWELS.find((item) => item.symbol === symbol)!;
              const active = target.symbol === symbol;
              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => setTarget(vowel)}
                  aria-pressed={active}
                  className={`flex-1 rounded-xl border px-3 py-3 font-mono text-lg transition ${active ? 'border-ember bg-ember/15 text-bone shadow-ember-soft' : 'border-white/10 text-smoke hover:border-ember/50 hover:text-bone'}`}
                >
                  {symbol}
                  <span className="block text-[10px] uppercase tracking-wider">{vowel.word}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-smoke">Articulation match</p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums text-bone">{Math.round(accuracy)}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-ember-edge transition-[width] duration-150" style={{ width: `${accuracy}%` }} />
          </div>
          <p className="mt-2 text-xs text-smoke">
            Euclidean distance from the target ({target.f1} / {target.f2} Hz), the same score the Therapy profile shows live.
          </p>
        </div>
      </div>
    </div>
  );
}
