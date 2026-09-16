'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { acceleratorFromKeyboardEvent, checkAccelerator, displayAcceleratorKeys } from '../../../../electron/accelerator';
import { buttonStyles } from '@/components/modals/Modal';
import type { HotkeyAction, HotkeyRegistration, HotkeyStatus } from '@/types/omnivoice';
import { cn } from '@/lib/cn';

function Keys({ keys }: { keys: string[] }) {
  return (
    <kbd className="flex flex-wrap items-center gap-1 font-sans">
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="rounded-md border border-white/20 bg-white/[0.06] px-2 py-0.5 font-display text-sm font-semibold text-ink"
        >
          {key}
        </kbd>
      ))}
    </kbd>
  );
}

function statusLabel(registration: HotkeyRegistration): { text: string; className: string } {
  if (!registration.registered) return { text: 'Taken by another app', className: 'text-warn' };
  if (!registration.verified) return { text: 'Needs desktop approval', className: 'text-warn' };
  return { text: 'Active', className: 'text-neon-cyan' };
}

export function ShortcutSettingsPanel() {
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  const [inDesktopApp, setInDesktopApp] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [heldKeys, setHeldKeys] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<HotkeyAction, string>>>({});
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState(false);
  const recordingRef = useRef<HotkeyAction | null>(null);
  const platform = typeof window !== 'undefined' ? (window.omnivoice?.platform ?? 'linux') : 'linux';

  useEffect(() => {
    const bridge = window.omnivoice;
    setInDesktopApp(Boolean(bridge));
    if (!bridge) return;
    void bridge.hotkeys.getStatus().then(setStatus);
    return bridge.hotkeys.onChange(setStatus);
  }, []);

  const stopRecording = useCallback(async () => {
    recordingRef.current = null;
    setRecording(null);
    setHeldKeys([]);
    const bridge = window.omnivoice;
    if (bridge) setStatus(await bridge.hotkeys.suspend(false));
  }, []);

  const startRecording = async (action: HotkeyAction) => {
    const bridge = window.omnivoice;
    if (!bridge) return;
    setErrors((current) => ({ ...current, [action]: undefined }));
    // Release the global shortcuts so the combination being pressed reaches this window.
    setStatus(await bridge.hotkeys.suspend(true));
    recordingRef.current = action;
    setRecording(action);
    setAnnouncement('Press the new key combination, or Escape to cancel.');
  };

  const save = useCallback(
    async (action: HotkeyAction, accelerator: string) => {
      const bridge = window.omnivoice;
      if (!bridge || !status) return;
      const label = status.registrations.find((item) => item.action === action)?.label ?? 'Shortcut';
      setSaving(true);
      recordingRef.current = null;
      setRecording(null);
      setHeldKeys([]);
      try {
        const result = await bridge.hotkeys.update({ [action]: accelerator });
        setStatus(result.status);
        if (result.ok) {
          setAnnouncement(`${label} is now ${displayAcceleratorKeys(accelerator, platform).join(' + ')}.`);
        } else {
          const message = result.errors[action] ?? 'That shortcut could not be saved.';
          setErrors((current) => ({ ...current, [action]: message }));
          setAnnouncement(message);
        }
      } finally {
        setSaving(false);
      }
    },
    [platform, status],
  );

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const action = recordingRef.current;
      if (!action) return;
      const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;

      // Plain Tab ends recording so keyboard users are never trapped.
      if (plain && event.key === 'Tab') {
        void stopRecording();
        setAnnouncement('Recording cancelled.');
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (plain && event.key === 'Escape') {
        void stopRecording();
        setAnnouncement('Recording cancelled.');
        return;
      }

      const recorded = acceleratorFromKeyboardEvent(event, platform);
      setHeldKeys(recorded.heldKeys);
      if (recorded.unsupportedKey) {
        setErrors((current) => ({ ...current, [action]: 'That key cannot be used in a shortcut. Try a letter, number, or function key.' }));
        return;
      }
      if (!recorded.accelerator) return;

      const check = checkAccelerator(recorded.accelerator, platform);
      if (!check.ok) {
        setErrors((current) => ({ ...current, [action]: check.message }));
        setAnnouncement(check.message);
        return;
      }
      void save(action, recorded.accelerator);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (recordingRef.current) setHeldKeys(acceleratorFromKeyboardEvent(event, platform).heldKeys);
    };

    // Capture phase, so Escape reaches this handler before the dialog treats it as "close".
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [recording, platform, save, stopRecording]);

  // Never leave the global shortcuts released if the panel goes away mid-recording.
  useEffect(
    () => () => {
      if (recordingRef.current) void window.omnivoice?.hotkeys.suspend(false);
    },
    [],
  );

  const resetOne = (registration: HotkeyRegistration) => save(registration.action, registration.defaultAccelerator);

  const resetAll = async () => {
    const bridge = window.omnivoice;
    if (!bridge) return;
    setErrors({});
    setStatus(await bridge.hotkeys.reset());
    setAnnouncement('All shortcuts are back to their defaults.');
  };

  if (inDesktopApp === false) {
    return <p className="text-mist">Global shortcuts can be changed in the Voicematics desktop app.</p>;
  }

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-mist">
        These shortcuts work from any app. Choose Change, then press the new key combination. Include Ctrl, Alt, or
        Super{platform === 'darwin' ? ' (Cmd, Control, or Option on a Mac)' : ''} so normal typing still works.
      </p>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {status?.note && <p className="max-w-prose rounded-xl border border-warn/50 bg-warn/[0.07] p-3 text-ink">{status.note}</p>}

      <ul className="divide-y divide-white/10 rounded-xl border border-white/10">
        {status?.registrations.map((registration) => {
          const isRecording = recording === registration.action;
          const state = statusLabel(registration);
          const error = errors[registration.action];
          return (
            <li key={registration.action} className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold text-ink">{registration.label}</p>
                  {!isRecording && <p className={cn('text-sm font-bold', state.className)}>{state.text}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isRecording ? (
                    <span className="flex min-h-10 items-center gap-2 rounded-lg border-2 border-dashed border-neon-cyan px-3 text-ink">
                      {heldKeys.length > 0 ? <Keys keys={[...heldKeys, '…']} /> : 'Press keys…'}
                    </span>
                  ) : (
                    <Keys keys={registration.keys} />
                  )}
                  {isRecording ? (
                    <button type="button" onClick={() => void stopRecording()} className={buttonStyles.secondary}>
                      Cancel
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void startRecording(registration.action)}
                        disabled={saving || recording !== null}
                        aria-label={`Change ${registration.label} shortcut`}
                        className={buttonStyles.secondary}
                      >
                        Change
                      </button>
                      {!registration.isDefault && (
                        <button
                          type="button"
                          onClick={() => void resetOne(registration)}
                          disabled={saving || recording !== null}
                          aria-label={`Reset ${registration.label} to its default shortcut`}
                          className="inline-flex size-10 items-center justify-center rounded-lg border border-white/15 text-mist transition-colors hover:bg-white/10 hover:text-ink disabled:opacity-60"
                        >
                          <RotateCcw aria-hidden className="size-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {isRecording && (
                <p className="text-sm text-mist">Press the new combination. Escape cancels; other shortcuts are paused until you finish.</p>
              )}
              {error && <p className="text-sm text-warn">{error}</p>}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => void resetAll()}
        disabled={saving || recording !== null || !status || status.registrations.every((item) => item.isDefault)}
        className={buttonStyles.secondary}
      >
        <RotateCcw aria-hidden className="size-4" />
        Reset all shortcuts
      </button>
    </div>
  );
}
