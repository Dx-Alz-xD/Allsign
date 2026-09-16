'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import type { ProfilePreset } from '@shared/types';
import { buttonStyles } from '@/components/modals/Modal';
import { Switch, inputStyles } from '@/components/modals/settings/controls';
import { useSession } from '@/components/providers/SessionProvider';
import { TelemetryBar } from '@/components/TelemetryBar';
import { HUDCanvas } from '@/components/HUDCanvas';
import { api } from '@/lib/api/client';

const DAF_MIN = 30;
const DAF_MAX = 150;

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-bold text-mist">
          {label}
        </label>
        <span className="font-display text-lg font-semibold tabular-nums text-ink">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[#00F2FE] disabled:opacity-50"
      />
    </div>
  );
}

/** DAF/FSF feedback controls, saved presets, and the fluency telemetry. */
export function FluencyPanel() {
  const session = useSession();
  const { feedback, feedbackEnabled, setFeedback, setFeedbackEnabled, engine, telemetry, peer, backendOnline } = session;
  const [dafOn, setDafOn] = useState(feedback.dafDelayMs > 0);
  const [presets, setPresets] = useState<ProfilePreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { daf: useId(), fsf: useId(), gain: useId(), name: useId(), enable: useId() };

  const loadPresets = useCallback(async () => {
    try {
      setPresets(await api.presets.list('fluency'));
    } catch {
      setPresets([]);
    }
  }, []);

  useEffect(() => {
    if (backendOnline) void loadPresets();
  }, [backendOnline, loadPresets]);

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.presets.create({
        name,
        mode: 'fluency',
        dafDelayMs: dafOn ? feedback.dafDelayMs : 0,
        fsfOctaveShift: feedback.fsfOctaveShift,
        parameters: { feedbackGain: feedback.feedbackGain },
      });
      setPresetName('');
      setNotice(`Saved "${name}".`);
      await loadPresets();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (preset: ProfilePreset) => {
    const gain = preset.parameters.feedbackGain;
    setDafOn(preset.dafDelayMs > 0);
    setFeedback({
      dafDelayMs: preset.dafDelayMs > 0 ? preset.dafDelayMs : feedback.dafDelayMs,
      fsfOctaveShift: preset.fsfOctaveShift,
      feedbackGain: typeof gain === 'number' ? gain : feedback.feedbackGain,
    });
    setNotice(`Loaded "${preset.name}".`);
  };

  const removePreset = async (preset: ProfilePreset) => {
    try {
      await api.presets.remove(preset.id);
      await loadPresets();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const latencyMs = engine.fluency?.fsfLatencyMs ?? null;

  return (
    <div className="flex flex-col gap-4">
      <TelemetryBar source={telemetry} peer={peer} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Feedback" className="glass flex flex-col gap-5 rounded-2xl p-5">
          <Switch checked={feedbackEnabled} onChange={setFeedbackEnabled} label="Hear my voice back" describedBy={ids.enable} />
          <p id={ids.enable} className="text-sm text-mist">
            {engine.state === 'running'
              ? `Use headphones. The shifted signal itself lags by ${latencyMs ? latencyMs.toFixed(0) : '~21'} ms; the delay below is the total you hear.`
              : 'Start the microphone to hear feedback.'}
          </p>

          <Switch
            checked={dafOn}
            onChange={(on) => {
              setDafOn(on);
              setFeedback({ dafDelayMs: on ? Math.max(DAF_MIN, feedback.dafDelayMs || 60) : 0 });
            }}
            label="Delayed auditory feedback"
          />
          <Slider
            id={ids.daf}
            label="Delay"
            value={Math.max(DAF_MIN, feedback.dafDelayMs || 60)}
            min={DAF_MIN}
            max={DAF_MAX}
            step={5}
            disabled={!dafOn}
            format={(value) => `${value} ms`}
            onChange={(value) => setFeedback({ dafDelayMs: value })}
          />
          <Slider
            id={ids.fsf}
            label="Pitch shift"
            value={feedback.fsfOctaveShift}
            min={-0.5}
            max={0.5}
            step={0.05}
            format={(value) => (Math.abs(value) < 0.001 ? 'off' : `${value > 0 ? '+' : ''}${(value * 12).toFixed(1)} semitones`)}
            onChange={(value) => setFeedback({ fsfOctaveShift: value })}
          />
          <Slider
            id={ids.gain}
            label="Feedback level"
            value={feedback.feedbackGain}
            min={0}
            max={2}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(value) => setFeedback({ feedbackGain: value })}
          />
        </section>

        <section aria-label="Presets" className="glass flex flex-col gap-4 rounded-2xl p-5">
          <h3 className="text-base font-semibold text-ink">Saved presets</h3>
          {presets.length === 0 ? (
            <p className="text-mist">{backendOnline ? 'No presets saved yet.' : 'Presets need the backend.'}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {presets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2">
                  <button type="button" onClick={() => applyPreset(preset)} className="min-w-0 flex-1 text-left">
                    <span className="block font-display font-semibold text-ink">{preset.name}</span>
                    <span className="block text-sm text-mist">
                      {preset.dafDelayMs > 0 ? `${preset.dafDelayMs} ms delay` : 'no delay'},{' '}
                      {Math.abs(preset.fsfOctaveShift) < 0.001 ? 'no pitch shift' : `${(preset.fsfOctaveShift * 12).toFixed(1)} semitones`}
                    </span>
                  </button>
                  <button type="button" onClick={() => void removePreset(preset)} aria-label={`Delete preset ${preset.name}`} className="rounded-lg p-2 text-mist hover:bg-white/10 hover:text-warn">
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={ids.name} className="text-sm font-bold text-mist">
                Save current settings as
              </label>
              <input id={ids.name} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Reading practice" className={inputStyles} />
            </div>
            <button type="button" onClick={() => void savePreset()} disabled={busy || !presetName.trim() || !backendOnline} className={buttonStyles.secondary}>
              <Save aria-hidden className="size-4" />
              Save
            </button>
          </div>
          {notice && <p className="text-sm text-mist">{notice}</p>}
        </section>
      </div>

      <section aria-label="Breathing guide" className="glass flex flex-col gap-3 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-ink">Breathing guide</h3>
        <HUDCanvas source={telemetry} layers={['breathing']} label="Breathing guide wave with your voice volume traced over it" canvasClassName="h-44" />
      </section>
    </div>
  );
}
