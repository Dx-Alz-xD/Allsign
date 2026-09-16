'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'animejs';

const ROWS = 9;
const COLUMNS = 96;
const BEAT_MS = 1600;

/**
 * Background canvas: a grid of waveform traces whose amplitude pulses on a beat. Anime.js drives the
 * pulse and phase values; the canvas redraws whatever those values are on each frame.
 */
export function WaveformGrid({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const state = { pulse: 0.25, phase: 0 };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pulse = animate(state, {
      pulse: [
        { to: 1, duration: BEAT_MS * 0.35, ease: 'outExpo' },
        { to: 0.25, duration: BEAT_MS * 0.65, ease: 'inOutSine' },
      ],
      loop: true,
      autoplay: !reduced,
    });
    const drift = animate(state, { phase: Math.PI * 2, duration: 9000, ease: 'linear', loop: true, autoplay: !reduced });

    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const rowGap = height / (ROWS + 1);
      const columnGap = width / (COLUMNS - 1);
      for (let row = 0; row < ROWS; row++) {
        const y = rowGap * (row + 1);
        const centre = 1 - Math.abs(row - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
        const amplitude = rowGap * 0.42 * (0.3 + 0.7 * centre) * state.pulse;
        const hue = row % 2 === 0 ? '255, 51, 51' : '255, 102, 0';
        context.beginPath();
        for (let column = 0; column < COLUMNS; column++) {
          const x = column * columnGap;
          const t = column / COLUMNS;
          const envelope = Math.exp(-Math.pow((t - 0.5) / 0.32, 2));
          const wave = Math.sin(t * 22 + state.phase + row * 0.9) * 0.7 + Math.sin(t * 57 - state.phase * 2 + row) * 0.3;
          const dy = wave * amplitude * envelope;
          if (column === 0) context.moveTo(x, y + dy);
          else context.lineTo(x, y + dy);
        }
        context.strokeStyle = `rgba(${hue}, ${0.12 + 0.35 * state.pulse * centre})`;
        context.lineWidth = 1.2;
        context.shadowColor = `rgba(${hue}, ${0.6 * state.pulse})`;
        context.shadowBlur = 12 * state.pulse;
        context.stroke();
      }
      context.shadowBlur = 0;
      frame = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      pulse.revert();
      drift.revert();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none ${className}`} />;
}
