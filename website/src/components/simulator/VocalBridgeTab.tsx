'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Keyboard, Mic, Radar } from 'lucide-react';

// The desktop app analyses 16 kHz audio with a 256-point FFT: 128 bins, 62.5 Hz each.
const SAMPLE_RATE = 16_000;
const FFT_SIZE = 256;
const BINS = FFT_SIZE / 2;
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;
const HUM_HZ = 120;
const HUM_SECONDS = 1.4;
const HARMONICS = 10;
const MATCH_THRESHOLD = 0.85;
const CONSECUTIVE_FRAMES = 2;
const TYPED_PHRASE = 'I need assistance.';
const SHORTCUT = 'Ctrl+Shift+H';

/** The enrolled fingerprint: the harmonic profile of a hum, spread over neighbouring bins like a real capture. */
function enrolledTemplate(): Float32Array {
  const template = new Float32Array(BINS);
  for (let k = 1; k <= HARMONICS; k++) {
    const centre = (k * HUM_HZ) / BIN_HZ;
    const level = 1 / k;
    for (let bin = 0; bin < BINS; bin++) {
      const distance = bin - centre;
      template[bin] += level * Math.exp(-distance * distance * 0.9);
    }
  }
  for (let bin = 0; bin < BINS; bin++) template[bin] += 0.01; // noise floor
  return template;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

type Phase = 'idle' | 'listening' | 'matched';

export function VocalBridgeTab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef(0);
  const template = useRef(enrolledTemplate());
  const [phase, setPhase] = useState<Phase>('idle');
  const [similarity, setSimilarity] = useState(0);
  const [typed, setTyped] = useState('');
  const [peakHz, setPeakHz] = useState<number | null>(null);
  const streak = useRef(0);
  const typing = useRef<number | null>(null);

  const stopDrawing = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(
    () => () => {
      stopDrawing();
      window.clearInterval(typing.current ?? undefined);
      void contextRef.current?.close();
    },
    [stopDrawing],
  );

  const typeOut = useCallback(() => {
    let index = 0;
    setTyped('');
    window.clearInterval(typing.current ?? undefined);
    typing.current = window.setInterval(() => {
      index++;
      setTyped(TYPED_PHRASE.slice(0, index));
      if (index >= TYPED_PHRASE.length) window.clearInterval(typing.current ?? undefined);
    }, 45);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const magnitudes = new Float32Array(BINS);
    const bytes = new Uint8Array(BINS);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const tick = () => {
      analyser.getByteFrequencyData(bytes);
      let peak = 0;
      for (let i = 0; i < BINS; i++) {
        magnitudes[i] = bytes[i] / 255;
        if (bytes[i] > bytes[peak]) peak = i;
      }
      const score = cosine(magnitudes, template.current);
      setSimilarity(score);
      setPeakHz(bytes[peak] > 40 ? peak * BIN_HZ : null);

      context.clearRect(0, 0, width, height);
      const barWidth = width / BINS;
      for (let i = 0; i < BINS; i++) {
        const level = magnitudes[i];
        const barHeight = level * (height - 18);
        const hue = 20 - level * 20; // orange -> red as the bin gets louder
        context.fillStyle = `hsla(${hue}, 100%, ${45 + level * 20}%, ${0.35 + level * 0.65})`;
        context.fillRect(i * barWidth + 0.5, height - 14 - barHeight, Math.max(1, barWidth - 1), barHeight);
      }
      context.fillStyle = 'rgba(154,154,154,0.8)';
      context.font = '10px ui-monospace, monospace';
      for (const hz of [0, 1000, 2000, 4000, 6000, 8000]) {
        const x = (hz / BIN_HZ) * barWidth;
        context.fillText(hz === 0 ? '0 Hz' : `${hz / 1000}k`, Math.min(x, width - 22), height - 2);
      }

      if (score >= MATCH_THRESHOLD) {
        streak.current++;
        if (streak.current >= CONSECUTIVE_FRAMES) {
          setPhase((current) => {
            if (current === 'listening') typeOut();
            return 'matched';
          });
        }
      } else {
        streak.current = 0;
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
  }, [typeOut]);

  const hum = async () => {
    if (phase === 'listening') return;
    const context = contextRef.current ?? new AudioContext({ sampleRate: SAMPLE_RATE });
    contextRef.current = context;
    if (context.state === 'suspended') await context.resume();
    const analyser = analyserRef.current ?? context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    analyserRef.current = analyser;

    // A hum: a pulse train of harmonics at 120 Hz with light vibrato, shaped by an envelope.
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.12);
    gain.gain.setValueAtTime(0.35, now + HUM_SECONDS - 0.25);
    gain.gain.linearRampToValueAtTime(0, now + HUM_SECONDS);
    gain.connect(analyser);
    analyser.connect(context.destination);
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5.5;
    const vibratoDepth = context.createGain();
    vibratoDepth.gain.value = 2.5;
    vibrato.connect(vibratoDepth);
    for (let k = 1; k <= HARMONICS; k++) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = HUM_HZ * k;
      vibratoDepth.connect(oscillator.detune);
      const partial = context.createGain();
      partial.gain.value = 1 / k;
      oscillator.connect(partial);
      partial.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + HUM_SECONDS);
    }
    vibrato.start(now);
    vibrato.stop(now + HUM_SECONDS);

    streak.current = 0;
    setTyped('');
    setPhase('listening');
    stopDrawing();
    draw();
    window.setTimeout(() => {
      stopDrawing();
      setPhase((current) => (current === 'listening' ? 'idle' : current));
    }, HUM_SECONDS * 1000 + 300);
    const button = document.getElementById('hum-button');
    if (button) animate(button, { scale: [1, 1.08, 1], duration: 500, ease: 'outBack(2)' });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="panel p-5">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-smoke">
          <span className="flex items-center gap-2">
            <Radar aria-hidden className="size-3.5 text-ember" />
            128-bin FFT · 62.5 Hz per bin
          </span>
          <span className="tabular-nums">{peakHz === null ? 'peak —' : `peak ${Math.round(peakHz)} Hz`}</span>
        </div>
        <canvas ref={canvasRef} aria-label="Live spectrum analyser" className="mt-3 h-52 w-full rounded-lg bg-black/40" />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button id="hum-button" type="button" onClick={() => void hum()} disabled={phase === 'listening'} className="btn-primary">
            <Mic aria-hidden className={`size-4 ${phase === 'listening' ? 'animate-pulse' : ''}`} />
            {phase === 'listening' ? 'Listening…' : 'Play hum sample'}
          </button>
          <div className="text-sm text-smoke">
            Vector match{' '}
            <span className={`font-mono text-lg tabular-nums ${similarity >= MATCH_THRESHOLD ? 'text-ember' : 'text-bone'}`}>{similarity.toFixed(2)}</span>{' '}
            <span className="text-xs">/ threshold {MATCH_THRESHOLD.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div className="panel flex flex-col gap-4 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-smoke">Enrolled trigger</p>
          <p className="mt-1 font-display text-lg font-semibold text-bone">Low hum → “{TYPED_PHRASE}”</p>
          <p className="text-xs text-smoke">Action: type the phrase, then press {SHORTCUT}</p>
        </div>
        <div className={`rounded-xl border p-4 transition ${phase === 'matched' ? 'border-ember/70 bg-ember/10 shadow-ember-soft' : 'border-white/10 bg-black/30'}`} aria-live="polite">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-smoke">
            <Keyboard aria-hidden className="size-3.5" />
            OS action
          </p>
          <p className="mt-2 min-h-[1.75rem] font-mono text-bone">
            {phase === 'matched' ? (
              <>
                Typed: “{typed}”<span className="animate-pulse text-ember">▍</span>
              </>
            ) : (
              <span className="text-smoke/60">Waiting for a match…</span>
            )}
          </p>
          {phase === 'matched' && typed.length === TYPED_PHRASE.length && <p className="mt-2 text-xs text-ember">Shortcut {SHORTCUT} sent to the focused app.</p>}
        </div>
        <p className="text-xs text-smoke">The same cosine match runs in the desktop app on every 10 ms frame, against fingerprints stored on your machine.</p>
      </div>
    </div>
  );
}
