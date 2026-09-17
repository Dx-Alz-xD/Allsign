'use client';

import { useEffect, useRef } from 'react';
import { animate, createTimer } from 'animejs';
import { reducedMotion } from '@/lib/motion';

const ROWS = 11;
const COLUMNS = 128;
const BEAT_MS = 1600;
const BOOT_MS = 1400;

/**
 * The hero's floor: rows of signal traces that boot in from the centre, pulse on a beat and answer the
 * pointer. Moving the pointer is the visitor's "voice": speed becomes energy, and the trace nearest the
 * pointer brightens, so the page reacts the way the app reacts to a microphone.
 */
export function WaveformGrid({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const still = reducedMotion();

    // What anime.js drives; the canvas only draws.
    const state = { pulse: 0.25, phase: 0, boot: still ? 1 : 0, energy: 0, pointerX: 0.5, pointerY: 0.5 };
    const pulse = animate(state, {
      pulse: [
        { to: 1, duration: BEAT_MS * 0.35, ease: 'outExpo' },
        { to: 0.25, duration: BEAT_MS * 0.65, ease: 'inOutSine' },
      ],
      loop: true,
      autoplay: !still,
    });
    const drift = animate(state, { phase: Math.PI * 2, duration: 9000, ease: 'linear', loop: true, autoplay: !still });
    const boot = animate(state, { boot: 1, duration: BOOT_MS, ease: 'outCubic', delay: 150, autoplay: !still });
    // Energy from pointer speed decays on its own.
    const decay = createTimer({
      onUpdate: () => {
        state.energy *= 0.94;
      },
      autoplay: !still,
    });

    let last = { x: 0, y: 0, t: performance.now() };
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const now = performance.now();
      const dt = Math.max(8, now - last.t);
      const speed = Math.hypot(event.clientX - last.x, event.clientY - last.y) / dt; // px per ms
      last = { x: event.clientX, y: event.clientY, t: now };
      state.energy = Math.min(1, state.energy + speed * 0.35);
      state.pointerX = (event.clientX - rect.left) / Math.max(1, rect.width);
      state.pointerY = (event.clientY - rect.top) / Math.max(1, rect.height);
    };
    if (!still) window.addEventListener('pointermove', onMove, { passive: true });

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
      const level = state.pulse + state.energy * 1.4;
      for (let row = 0; row < ROWS; row++) {
        const y = rowGap * (row + 1);
        const centre = 1 - Math.abs(row - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
        const nearPointer = Math.max(0, 1 - Math.abs(y / height - state.pointerY) * 6);
        const amplitude = rowGap * 0.45 * (0.25 + 0.75 * centre) * level * (1 + nearPointer * state.energy * 2);
        const hue = row % 2 === 0 ? '255, 51, 51' : '255, 102, 0';
        context.beginPath();
        for (let column = 0; column < COLUMNS; column++) {
          const t = column / COLUMNS;
          // Boot: traces grow outwards from the centre column.
          const visible = Math.abs(t - 0.5) <= state.boot * 0.5 + 0.002;
          const x = column * columnGap;
          const envelope = Math.exp(-Math.pow((t - 0.5) / 0.34, 2)) * (visible ? 1 : 0);
          const pointerBump = Math.exp(-Math.pow((t - state.pointerX) / 0.08, 2)) * state.energy * 2.2;
          const wave = Math.sin(t * 22 + state.phase + row * 0.9) * 0.7 + Math.sin(t * 57 - state.phase * 2 + row) * 0.3;
          const dy = wave * amplitude * (envelope + pointerBump * centre);
          if (column === 0) context.moveTo(x, y + dy);
          else context.lineTo(x, y + dy);
        }
        const alpha = (0.1 + 0.4 * level * centre + nearPointer * state.energy * 0.5) * state.boot;
        context.strokeStyle = `rgba(${hue}, ${Math.min(0.95, alpha)})`;
        context.lineWidth = 1.2 + nearPointer * state.energy;
        context.shadowColor = `rgba(${hue}, ${0.7 * level})`;
        context.shadowBlur = 10 * level;
        context.stroke();
      }
      // The boot scanline.
      if (state.boot < 1) {
        const half = state.boot * 0.5 * width;
        for (const x of [width / 2 - half, width / 2 + half]) {
          const gradient = context.createLinearGradient(x - 40, 0, x + 40, 0);
          gradient.addColorStop(0, 'rgba(255,102,0,0)');
          gradient.addColorStop(0.5, 'rgba(255,102,0,0.35)');
          gradient.addColorStop(1, 'rgba(255,102,0,0)');
          context.fillStyle = gradient;
          context.fillRect(x - 40, 0, 80, height);
        }
      }
      context.shadowBlur = 0;
      if (!still) frame = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (still) draw();
    else frame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      observer.disconnect();
      pulse.revert();
      drift.revert();
      boot.revert();
      decay.revert();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none ${className}`} />;
}
