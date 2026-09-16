'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Mic, Square, Volume2 } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { SettingSection, inputStyles } from '@/components/modals/settings/controls';
import { useSettings } from '@/components/providers/SettingsProvider';
import { SYSTEM_DEFAULT_DEVICE } from '@/lib/settings/schema';
import { cn } from '@/lib/cn';

type Access = 'checking' | 'needs-permission' | 'granted' | 'denied' | 'unsupported';

/** Chromium adds these pseudo-devices; the "System default" option already covers them. */
const PSEUDO_DEVICE_IDS = new Set(['default', 'communications']);
const METER_SEGMENTS = 20;

type SinkAudioContext = AudioContext & { setSinkId(sinkId: string): Promise<void> };

function canChooseOutput(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

function describeMediaError(error: unknown): { access: Access; message: string } {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      access: 'denied',
      message:
        'Microphone access is blocked. Allow Voicematics in your system privacy settings (on macOS, Privacy & Security, then Microphone), then reopen Settings.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { access: 'granted', message: 'That microphone is no longer available. Choose another one.' };
  }
  return { access: 'needs-permission', message: 'The microphone could not be opened. Check that no other app is using it.' };
}

function useAudioDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [access, setAccess] = useState<Access>('checking');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAccess('unsupported');
      return;
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list);
    // Device names are hidden until the person allows microphone access.
    setAccess((current) =>
      list.some((device) => device.kind === 'audioinput' && device.label) ? 'granted' : current === 'denied' ? 'denied' : 'needs-permission',
    );
  }, []);

  useEffect(() => {
    void refresh();
    const media = navigator.mediaDevices;
    const handleChange = () => void refresh();
    media?.addEventListener('devicechange', handleChange);
    return () => media?.removeEventListener('devicechange', handleChange);
  }, [refresh]);

  const requestAccess = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await refresh();
    } catch (reason) {
      const described = describeMediaError(reason);
      setAccess(described.access);
      setError(described.message);
    }
  };

  const listed = (kind: MediaDeviceKind) =>
    devices.filter((device) => device.kind === kind && !PSEUDO_DEVICE_IDS.has(device.deviceId) && device.deviceId);

  return { inputs: listed('audioinput'), outputs: listed('audiooutput'), access, error, setError, requestAccess };
}

function InputLevelMeter({ deviceId, onError }: { deviceId: string; onError: (message: string) => void }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId === SYSTEM_DEFAULT_DEVICE ? undefined : { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (cancelled) return;
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let lastUpdate = 0;

      // A preview meter only: one RMS over 1024 samples, 20 times a second.
      const tick = (time: number) => {
        frame = requestAnimationFrame(tick);
        if (time - lastUpdate < 50) return;
        lastUpdate = time;
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const db = 20 * Math.log10(Math.sqrt(energy / samples.length) + 1e-9);
        setLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
      };
      frame = requestAnimationFrame(tick);
    })().catch((reason: unknown) => {
      if (!cancelled) onError(describeMediaError(reason).message);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [deviceId, onError]);

  const lit = Math.round(level * METER_SEGMENTS);
  const percent = Math.round(level * 100);

  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      className="flex h-4 gap-1"
    >
      {Array.from({ length: METER_SEGMENTS }, (_, index) => (
        <span
          key={index}
          className={cn(
            'flex-1 rounded-sm',
            index < lit ? (index >= METER_SEGMENTS - 3 ? 'bg-warn' : 'bg-neon-cyan') : 'bg-white/10',
          )}
        />
      ))}
    </div>
  );
}

async function playTestSound(outputDeviceId: string): Promise<void> {
  const context = new AudioContext();
  if (outputDeviceId !== SYSTEM_DEFAULT_DEVICE && canChooseOutput()) {
    await (context as SinkAudioContext).setSinkId(outputDeviceId);
  }
  const start = context.currentTime + 0.05;
  [660, 880].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = start + index * 0.22;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(0.18, noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.35);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.4);
  });
  window.setTimeout(() => void context.close(), 1200);
}

export function AudioSettingsPanel() {
  const { settings, updateAudio } = useSettings();
  const { inputs, outputs, access, error, setError, requestAccess } = useAudioDevices();
  const [testingInput, setTestingInput] = useState(false);
  const [outputMessage, setOutputMessage] = useState('');
  const inputId = useId();
  const outputId = useId();
  const outputSelectable = canChooseOutput();

  const { inputDeviceId, inputLabel, outputDeviceId, outputLabel } = settings.audio;
  const inputAvailable = inputDeviceId === SYSTEM_DEFAULT_DEVICE || inputs.some((device) => device.deviceId === inputDeviceId);
  const outputAvailable = outputDeviceId === SYSTEM_DEFAULT_DEVICE || outputs.some((device) => device.deviceId === outputDeviceId);
  const selectedInput = inputAvailable ? inputDeviceId : SYSTEM_DEFAULT_DEVICE;
  const selectedOutput = outputAvailable ? outputDeviceId : SYSTEM_DEFAULT_DEVICE;
  const labelsVisible = access === 'granted';

  const stopMeterWithError = useCallback(
    (message: string) => {
      setTestingInput(false);
      setError(message);
    },
    [setError],
  );

  if (access === 'unsupported') {
    return <p className="text-mist">This system does not let apps list audio devices, so Voicematics uses the system defaults.</p>;
  }

  return (
    <div className="space-y-10">
      {access !== 'granted' && access !== 'checking' && (
        <div className="rounded-xl border border-warn/50 bg-warn/[0.07] p-4">
          <p className="max-w-prose text-ink">
            {access === 'denied'
              ? 'Microphone access is blocked, so device names are hidden.'
              : 'Allow microphone access to see the names of your devices. Voicematics only listens when you use it.'}
          </p>
          {access === 'needs-permission' && (
            <button type="button" onClick={() => void requestAccess()} className={cn(buttonStyles.primary, 'mt-3')}>
              <Mic aria-hidden className="size-4" />
              Allow microphone access
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-prose text-warn">
          {error}
        </p>
      )}

      <SettingSection title="Microphone" description="The microphone Voicematics listens to for speech analysis and custom triggers.">
        <div>
          <label htmlFor={inputId} className="mb-1.5 block font-semibold text-ink">
            Input device
          </label>
          <select
            id={inputId}
            value={selectedInput}
            onChange={(event) => {
              const device = inputs.find((item) => item.deviceId === event.target.value);
              updateAudio({ inputDeviceId: event.target.value, inputLabel: device?.label ?? '' });
            }}
            className={inputStyles}
          >
            <option value={SYSTEM_DEFAULT_DEVICE}>System default</option>
            {inputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
          {!inputAvailable && (
            <p className="mt-1.5 text-sm text-warn">
              {inputLabel || 'Your saved microphone'} is not connected, so the system default is used until it is.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              setError('');
              setTestingInput((value) => !value);
            }}
            aria-pressed={testingInput}
            className={testingInput ? buttonStyles.primary : buttonStyles.secondary}
          >
            {testingInput ? <Square aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
            {testingInput ? 'Stop microphone test' : 'Test microphone'}
          </button>
          {testingInput ? (
            <>
              <InputLevelMeter deviceId={selectedInput} onError={stopMeterWithError} />
              <p className="text-sm text-mist">Speak normally. The bars should move while you talk. Nothing is recorded.</p>
            </>
          ) : (
            <p className="text-sm text-mist">The microphone stays off until you start a test.</p>
          )}
        </div>
      </SettingSection>

      <SettingSection
        title="Speakers"
        description="Where Voicematics plays voice feedback and alert sounds. Spoken emergency phrases use your system's default output."
      >
        <div>
          <label htmlFor={outputId} className="mb-1.5 block font-semibold text-ink">
            Output device
          </label>
          <select
            id={outputId}
            value={selectedOutput}
            disabled={!outputSelectable}
            onChange={(event) => {
              const device = outputs.find((item) => item.deviceId === event.target.value);
              updateAudio({ outputDeviceId: event.target.value, outputLabel: device?.label ?? '' });
            }}
            className={inputStyles}
          >
            <option value={SYSTEM_DEFAULT_DEVICE}>System default</option>
            {outputSelectable &&
              outputs.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Speaker ${index + 1}`}
                </option>
              ))}
          </select>
          {!outputSelectable && (
            <p className="mt-1.5 text-sm text-mist">This system cannot route sound to a chosen device, so the system default is used.</p>
          )}
          {outputSelectable && !outputAvailable && (
            <p className="mt-1.5 text-sm text-warn">
              {outputLabel || 'Your saved speaker'} is not connected, so the system default is used until it is.
            </p>
          )}
          {outputSelectable && !labelsVisible && outputs.length > 0 && (
            <p className="mt-1.5 text-sm text-mist">Allow microphone access above to see speaker names.</p>
          )}
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setOutputMessage('');
              playTestSound(selectedOutput)
                .then(() => setOutputMessage('Played a two-note chime.'))
                .catch(() => setOutputMessage('That speaker could not play sound. Choose another one.'));
            }}
            className={buttonStyles.secondary}
          >
            <Volume2 aria-hidden className="size-4" />
            Play test sound
          </button>
          <p aria-live="polite" className="min-h-5 text-sm text-mist">
            {outputMessage}
          </p>
        </div>
      </SettingSection>
    </div>
  );
}
