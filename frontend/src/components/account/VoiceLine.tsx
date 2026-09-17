'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { animate, createTimer } from 'animejs';
import { reducedMotion } from '@/lib/motion';

export interface VoiceLineHandle {
  /** A ripple from the right edge, the way a keystroke would land on the trace. */
  pulse: (strength?: number) => void;
}

interface Impulse {
  bornMs: number;
  strength: number;
}

const IMPULSE_LIFE_MS = 1400;
const IMPULSE_SPEED = 0.0011; // fraction of the width per ms
const MAX_IMPULSES = 24;

/**
 * A single signal trace: quiet breathing on its own, and a ripple for every keystroke in the form beside
 * it. The sign-in screen's one moving part, so the app's promise (your voice becomes text, here) is on
 * screen before anyone has typed a word.
 */
export const VoiceLine = forwardRef<VoiceLineHandle, { className?: string; boot?: boolean }>(function VoiceLine({ className = '', boot = true }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const impulses = useRef<Impulse[]>([]);

  useImperativeHandle(ref, () => ({
    pulse: (strength = 1) => {
      if (reducedMotion()) return;
      impulses.current.push({ bornMs: performance.now(), strength });
      if (impulses.current.length > MAX_IMPULSES) impulses.current.shift();
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const still = reducedMotion();
    const state = { breath: 0.3, phase: 0, reveal: still || !boot ? 1 : 0 };

    const breathing = animate(state, {
      breath: [{ to: 0.7, duration: 1900, ease: 'inOutSine' }, { to: 0.3, duration: 2300, ease: 'inOutSine' }],
      loop: true,
      autoplay: !still,
    });
    const drift = animate(state, { phase: Math.PI * 2, duration: 7000, ease: 'linear', loop: true, autoplay: !still });
    const reveal = animate(state, { reveal: 1, duration: 1200, ease: 'outExpo', delay: 250, autoplay: !still && boot });

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
      const now = performance.now();
      impulses.current = impulses.current.filter((impulse) => now - impulse.bornMs < IMPULSE_LIFE_MS);
      const mid = height / 2;
      const base = height * 0.16 * state.breath;
      const points = 160;
      context.beginPath();
      for (let i = 0; i <= points; i++) {
        const t = i / points;
        if (t > state.reveal) break;
        const x = t * width;
        let y = Math.sin(t * 9 + state.phase) * 0.6 + Math.sin(t * 23 - state.phase * 1.7) * 0.4;
        y *= base * (0.35 + 0.65 * Math.sin(t * Math.PI));
        for (const impulse of impulses.current) {
          const age = now - impulse.bornMs;
          const centre = 1 - age * IMPULSE_SPEED; // travels right to left
          const distance = (t - centre) / 0.05;
          const life = 1 - age / IMPULSE_LIFE_MS;
          y += Math.exp(-distance * distance) * Math.sin(age / 40) * height * 0.32 * impulse.strength * life;
        }
        if (i === 0) context.moveTo(x, mid + y);
        else context.lineTo(x, mid + y);
      }
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(0, 242, 254, 0.15)');
      gradient.addColorStop(0.5, 'rgba(0, 242, 254, 0.95)');
      gradient.addColorStop(1, 'rgba(79, 172, 254, 0.9)');
      context.strokeStyle = gradient;
      context.lineWidth = 2;
      context.shadowColor = 'rgba(0, 242, 254, 0.7)';
      context.shadowBlur = 14;
      context.stroke();
      context.shadowBlur = 0;
    };

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(canvas);
    const ticker = createTimer({ onUpdate: draw, autoplay: !still });
    draw();

    return () => {
      observer.disconnect();
      ticker.revert();
      breathing.revert();
      drift.revert();
      reveal.revert();
    };
  }, [boot]);

  return <canvas ref={canvasRef} aria-hidden className={`block w-full ${className}`} />;
});
