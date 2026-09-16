'use client';

import { memo, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Pause, Play, RotateCcw } from 'lucide-react';
import {
  createBreathingState,
  createSpectrogramState,
  createSpectrumState,
  drawBreathing,
  drawSpectrogram,
  drawSpectrum,
  drawWaveform,
  type Rect,
} from '@/components/HUDCanvas/renderers';
import {
  BREATHING_PATTERNS,
  INITIAL_BREATHING_GUIDE,
  breathingPhaseAt,
  breathingPhaseLabel,
  getBreathingPattern,
  guideElapsedMs,
  type BreathingGuideState,
  type BreathingPattern,
  type BreathingPhase,
} from '@/lib/hud/breathing';
import type { TelemetrySource } from '@/lib/hud/types';
import { cn } from '@/lib/cn';

export type HudLayer = 'waveform' | 'spectrum' | 'spectrogram' | 'breathing';

const DEFAULT_LAYERS: readonly HudLayer[] = ['waveform', 'spectrum'];
const LAYER_WEIGHT: Record<HudLayer, number> = { waveform: 1, spectrum: 1.3, spectrogram: 1, breathing: 1 };
const LAYER_GAP_PX = 14;
const MAX_PIXEL_RATIO = 2;
const DB_FLOOR = -60;

interface HUDCanvasProps {
  source: TelemetrySource;
  /** Accessible description of what the canvas shows. */
  label: string;
  /** Stacked top to bottom in the order given. */
  layers?: readonly HudLayer[];
  className?: string;
  canvasClassName?: string;
}

function HUDCanvasBase({ source, label, layers = DEFAULT_LAYERS, className, canvasClassName }: HUDCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const [guide, setGuide] = useState<BreathingGuideState>(INITIAL_BREATHING_GUIDE);
  const liveRef = useRef({ guide, reducedMotion });
  const layerKey = layers.join(',');
  const hasBreathing = layers.includes('breathing');

  useEffect(() => {
    liveRef.current = { guide, reducedMotion };
  }, [guide, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const activeLayers = layerKey.split(',') as HudLayer[];
    const font = getComputedStyle(canvas).fontFamily || 'sans-serif';
    const spectrum = createSpectrumState();
    const spectrogram = createSpectrogramState();
    const breathing = createBreathingState();

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let rects: Rect[] = [];
    let visible = true;
    let lastTime = 0;
    let frameId = 0;

    const layout = () => {
      const bounds = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));

      const totalWeight = activeLayers.reduce((sum, layer) => sum + LAYER_WEIGHT[layer], 0);
      const usableHeight = height - LAYER_GAP_PX * (activeLayers.length - 1);
      let top = 0;
      rects = activeLayers.map((layer) => {
        const rect = { x: 0, y: top, w: width, h: (usableHeight * LAYER_WEIGHT[layer]) / totalWeight };
        top += rect.h + LAYER_GAP_PX;
        return rect;
      });
    };

    const render = (now: number) => {
      frameId = requestAnimationFrame(render);
      const dtSeconds = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
      lastTime = now;
      if (!visible || width === 0 || height === 0) return;

      const frame = source.getFrame();
      const live = liveRef.current;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      activeLayers.forEach((layer, index) => {
        const rect = rects[index];
        if (layer === 'waveform') drawWaveform(ctx, rect, frame);
        else if (layer === 'spectrum') drawSpectrum(ctx, rect, frame, spectrum, dtSeconds, font);
        else if (layer === 'spectrogram') drawSpectrogram(ctx, rect, frame, spectrogram, pixelRatio, font);
        else {
          drawBreathing(ctx, rect, {
            pattern: getBreathingPattern(live.guide.patternId),
            elapsedMs: guideElapsedMs(live.guide, now),
            running: live.guide.running,
            version: live.guide.version,
            voiceLevel: (frame.telemetry.volumeDb - DB_FLOOR) / -DB_FLOOR,
            reducedMotion: live.reducedMotion,
            state: breathing,
          });
        }
      });
    };

    const resizeObserver = new ResizeObserver(layout);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    resizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    layout();
    frameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
    };
  }, [source, layerKey]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className={cn('block h-56 w-full rounded-xl bg-black/25 ring-1 ring-white/10', canvasClassName)}
      />
      {hasBreathing && <BreathingControls guide={guide} onChange={setGuide} />}
    </div>
  );
}

export const HUDCanvas = memo(HUDCanvasBase);

function describePattern(pattern: BreathingPattern): string {
  const seconds = (ms: number) => `${ms / 1000} s`;
  const parts = [`In ${seconds(pattern.inhaleMs)}`, `out ${seconds(pattern.exhaleMs)}`];
  if (pattern.restMs > 0) parts.push(`rest ${seconds(pattern.restMs)}`);
  return parts.join(', ');
}

function BreathingControls({
  guide,
  onChange,
}: {
  guide: BreathingGuideState;
  onChange: Dispatch<SetStateAction<BreathingGuideState>>;
}) {
  const radioName = useId();
  const pattern = getBreathingPattern(guide.patternId);
  const [phase, setPhase] = useState<{ phase: BreathingPhase; seconds: number }>({ phase: 'inhale', seconds: 0 });

  useEffect(() => {
    const update = () => {
      const next = breathingPhaseAt(pattern, guideElapsedMs(guide, performance.now()));
      const seconds = Math.ceil(next.remainingMs / 1000);
      setPhase((current) =>
        current.phase === next.phase && current.seconds === seconds ? current : { phase: next.phase, seconds },
      );
    };
    update();
    if (!guide.running) return;
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [guide, pattern]);

  const toggle = () =>
    onChange((current) =>
      current.running
        ? { ...current, running: false, elapsedBeforeStart: guideElapsedMs(current, performance.now()) }
        : { ...current, running: true, startedAt: performance.now() },
    );

  const restart = () =>
    onChange((current) => ({
      ...current,
      startedAt: performance.now(),
      elapsedBeforeStart: 0,
      version: current.version + 1,
    }));

  const choosePattern = (patternId: BreathingPattern['id']) =>
    onChange((current) => ({
      ...current,
      patternId,
      startedAt: performance.now(),
      elapsedBeforeStart: 0,
      version: current.version + 1,
    }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-neon-cyan px-4 font-display font-semibold text-void transition-colors hover:bg-[#5FF7FF]"
        >
          {guide.running ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
          {guide.running ? 'Pause guide' : 'Start guide'}
        </button>
        <button
          type="button"
          onClick={restart}
          aria-label="Restart guide"
          className="inline-flex size-10 items-center justify-center rounded-lg border border-white/[0.12] text-mist transition-colors hover:bg-white/10 hover:text-ink"
        >
          <RotateCcw aria-hidden className="size-4" />
        </button>
        <fieldset className="flex items-center gap-1 rounded-lg border border-white/[0.12] p-1">
          <legend className="sr-only">Breathing pattern</legend>
          {BREATHING_PATTERNS.map((option) => (
            <label key={option.id} className="relative">
              <input
                type="radio"
                name={radioName}
                value={option.id}
                checked={option.id === guide.patternId}
                onChange={() => choosePattern(option.id)}
                className="peer sr-only"
              />
              <span className="block cursor-pointer rounded-md px-3 py-1.5 text-sm font-bold text-mist transition-colors hover:text-ink peer-checked:bg-white/10 peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-neon-cyan">
                {option.label}
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-lg font-semibold text-ink">
          <span aria-live="polite">
            {guide.running ? breathingPhaseLabel(pattern, phase.phase) : 'Press Start and follow the cyan wave'}
          </span>
          {guide.running && (
            <span aria-hidden className="ml-2 tabular-nums text-mist">
              {phase.seconds} s
            </span>
          )}
        </p>
        <p className="text-sm text-mist">{describePattern(pattern)}</p>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-mist">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded-full bg-neon-cyan" />
          Breathing target
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded-full bg-neon-blue" />
          Your voice volume
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3 w-5 rounded-sm bg-neon-blue/20" />
          Exhale, the time to speak
        </li>
      </ul>
    </div>
  );
}
