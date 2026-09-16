'use client';

import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PhonemeTarget } from '@shared/types';
import { buttonStyles } from '@/components/modals/Modal';
import { inputStyles } from '@/components/modals/settings/controls';
import { useSession } from '@/components/providers/SessionProvider';
import { usePolled } from '@/hooks/usePolled';
import { api } from '@/lib/api/client';
import type { VowelPlaneGeometry } from '@/workers/formant.worker';
import type { PipelineSnapshot } from '@/hooks/useAudioPipeline';
import { cn } from '@/lib/cn';

const CYAN = '#00F2FE';
const BLUE = '#4FACFE';
const MIST = '#A9B8CC';
const WARN = '#FFB347';
const TRAIL = 40;
const PAD = 28;

interface VowelPlaneProps {
  geometry: VowelPlaneGeometry | null;
  snapshotRef: { current: PipelineSnapshot };
  className?: string;
}

/** IPA-style vowel quadrilateral: reference vowels, the target, and the live F1/F2 point with a trail. */
function VowelPlaneBase({ geometry, snapshotRef, className }: VowelPlaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const trail: Array<[number, number]> = [];
    let width = 0;
    let height = 0;
    let ratio = 1;
    let frameId = 0;

    const layout = () => {
      const bounds = canvas.getBoundingClientRect();
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
    };

    const toPx = (x: number, y: number): [number, number] => [PAD + x * (width - 2 * PAD), PAD + y * (height - 2 * PAD)];

    const render = () => {
      frameId = requestAnimationFrame(render);
      if (width === 0 || height === 0) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const font = getComputedStyle(canvas).fontFamily || 'sans-serif';
      ctx.font = `13px ${font}`;

      if (!geometry) {
        ctx.fillStyle = MIST;
        ctx.fillText('Waiting for the formant analyser', PAD, height / 2);
        return;
      }

      // Trapezoid outline.
      ctx.strokeStyle = 'rgba(148, 197, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      geometry.corners.forEach(([x, y], index) => {
        const [px, py] = toPx(x, y);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = MIST;
      ctx.textAlign = 'left';
      ctx.fillText('front', PAD, PAD - 10);
      ctx.textAlign = 'right';
      ctx.fillText('back', width - PAD, PAD - 10);
      ctx.save();
      ctx.translate(10, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('close ↑   open ↓', 0, 0);
      ctx.restore();

      const snapshot = snapshotRef.current.formants;
      // Reference vowels, the target highlighted.
      for (const vowel of geometry.vowels) {
        const [px, py] = toPx(vowel.quad.x, vowel.quad.y);
        const isTarget = vowel.symbol === snapshot.target;
        ctx.beginPath();
        ctx.arc(px, py, isTarget ? 14 : 9, 0, Math.PI * 2);
        ctx.fillStyle = isTarget ? 'rgba(255, 179, 71, 0.25)' : 'rgba(255, 255, 255, 0.06)';
        ctx.fill();
        ctx.strokeStyle = isTarget ? WARN : 'rgba(255,255,255,0.25)';
        ctx.lineWidth = isTarget ? 2 : 1;
        ctx.stroke();
        ctx.fillStyle = isTarget ? WARN : MIST;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${isTarget ? 'bold ' : ''}14px ${font}`;
        ctx.fillText(vowel.symbol, px, py);
      }

      // Live point and trail.
      if (snapshot.voiced && snapshot.f1 > 0) {
        trail.push([snapshot.quadX, snapshot.quadY]);
        if (trail.length > TRAIL) trail.shift();
      } else if (trail.length > 0) {
        trail.shift();
      }
      if (trail.length > 1) {
        ctx.beginPath();
        trail.forEach(([x, y], index) => {
          const [px, py] = toPx(x, y);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = 'rgba(79, 172, 254, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (trail.length > 0) {
        const [x, y] = trail[trail.length - 1];
        const [px, py] = toPx(x, y);
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fillStyle = CYAN;
        ctx.fill();
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    const observer = new ResizeObserver(layout);
    observer.observe(canvas);
    layout();
    frameId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [geometry, snapshotRef]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Vowel quadrilateral with your current tongue position"
      className={cn('block h-72 w-full rounded-xl bg-black/25 ring-1 ring-white/10', className)}
    />
  );
}

export const VowelPlane = memo(VowelPlaneBase);

/** Formant readouts, target vowel, speaker profile and custom targets from the backend. */
export function TherapyPanel() {
  const { pipeline, live, backendOnline } = useSession();
  const { vowelGeometry, setFormantTarget, setFormantProfile, setFormantTargets, snapshotRef } = pipeline;
  const formants = usePolled(
    () => ({
      voiced: snapshotRef.current.formants.voiced,
      f1: Math.round(snapshotRef.current.formants.f1),
      f2: Math.round(snapshotRef.current.formants.f2),
      f3: Math.round(snapshotRef.current.formants.f3),
      accuracy: Math.round(snapshotRef.current.formants.accuracy),
      nearest: snapshotRef.current.formants.nearest,
      target: snapshotRef.current.formants.target,
    }),
    8,
  );
  const [customTargets, setCustomTargets] = useState<PhonemeTarget[]>([]);
  const [newPhoneme, setNewPhoneme] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { target: useId(), profile: useId(), phoneme: useId() };

  const loadTargets = useCallback(async () => {
    try {
      setCustomTargets(await api.phonemes.targets());
    } catch {
      setCustomTargets([]);
    }
  }, []);

  useEffect(() => {
    if (backendOnline) void loadTargets();
  }, [backendOnline, loadTargets]);

  const addCurrentAsTarget = async () => {
    const phoneme = newPhoneme.trim();
    if (!phoneme || formants.f1 <= 0 || formants.f2 <= 0) return;
    try {
      await api.phonemes.createTarget({ phoneme, exampleWord: null, f1: formants.f1, f2: formants.f2, f3: formants.f3 || 2500 });
      setNewPhoneme('');
      setNotice(`Saved ${phoneme} at F1 ${formants.f1}, F2 ${formants.f2}.`);
      await loadTargets();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const useCustomTargets = () => {
    if (customTargets.length === 0) return;
    setFormantTargets(customTargets.map((target) => ({ symbol: target.phoneme, label: target.exampleWord ?? target.phoneme, f1: target.f1, f2: target.f2, f3: target.f3 })));
    setNotice('Custom targets are now the reference vowels.');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section aria-label="Vowel space" className="glass flex flex-col gap-4 rounded-2xl p-5">
        <VowelPlane geometry={vowelGeometry} snapshotRef={snapshotRef} />
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-4">
          {(
            [
              ['F1', formants.voiced ? `${formants.f1} Hz` : '—'],
              ['F2', formants.voiced ? `${formants.f2} Hz` : '—'],
              ['F3', formants.voiced && formants.f3 > 0 ? `${formants.f3} Hz` : '—'],
              ['Accuracy', formants.target ? `${formants.accuracy}%` : 'no target'],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-panel px-3 py-2.5">
              <dt className="text-sm text-mist">{label}</dt>
              <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-mist">
          {!live
            ? 'Start the microphone and hold a vowel.'
            : formants.voiced
              ? `Closest reference vowel: ${formants.nearest ?? '—'}.`
              : 'No voicing right now.'}
        </p>
      </section>

      <div className="flex flex-col gap-4">
        <section aria-label="Target" className="glass flex flex-col gap-4 rounded-2xl p-5">
          <div>
            <label htmlFor={ids.target} className="text-sm font-bold text-mist">
              Target vowel
            </label>
            <select id={ids.target} value={formants.target ?? ''} onChange={(event) => setFormantTarget(event.target.value || null)} className={inputStyles}>
              <option value="">None</option>
              {(vowelGeometry?.vowels ?? []).map((vowel) => (
                <option key={vowel.symbol} value={vowel.symbol}>
                  /{vowel.symbol}/ as in {vowel.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.profile} className="text-sm font-bold text-mist">
              Reference voice
            </label>
            <select id={ids.profile} defaultValue="male" onChange={(event) => setFormantProfile(event.target.value as 'male' | 'female' | 'child')} className={inputStyles}>
              <option value="male">Adult, lower voice</option>
              <option value="female">Adult, higher voice</option>
              <option value="child">Child</option>
            </select>
          </div>
        </section>

        <section aria-label="Custom targets" className="glass flex flex-col gap-3 rounded-2xl p-5">
          <h3 className="text-base font-semibold text-ink">Your own targets</h3>
          {customTargets.length === 0 ? (
            <p className="text-sm text-mist">{backendOnline ? 'Hold a vowel and save its formants as a personal target.' : 'Custom targets need the backend.'}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {customTargets.map((target) => (
                <li key={target.id} className="flex items-center gap-2 text-sm">
                  <span className="font-display font-semibold text-ink">{target.phoneme}</span>
                  <span className="text-mist">
                    {Math.round(target.f1)} / {Math.round(target.f2)} / {Math.round(target.f3)} Hz
                  </span>
                  <button
                    type="button"
                    onClick={() => void api.phonemes.removeTarget(target.id).then(loadTargets)}
                    aria-label={`Delete target ${target.phoneme}`}
                    className="ml-auto rounded-lg p-1.5 text-mist hover:bg-white/10 hover:text-warn"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={ids.phoneme} className="text-sm font-bold text-mist">
                Save current vowel as
              </label>
              <input id={ids.phoneme} value={newPhoneme} onChange={(event) => setNewPhoneme(event.target.value)} placeholder="i" className={inputStyles} />
            </div>
            <button type="button" onClick={() => void addCurrentAsTarget()} disabled={!backendOnline || !formants.voiced || !newPhoneme.trim()} className={buttonStyles.secondary}>
              <Plus aria-hidden className="size-4" />
              Save
            </button>
          </div>
          {customTargets.length > 0 && (
            <button type="button" onClick={useCustomTargets} className={buttonStyles.secondary}>
              Use my targets as the reference set
            </button>
          )}
          {notice && <p className="text-sm text-mist">{notice}</p>}
        </section>
      </div>
    </div>
  );
}
