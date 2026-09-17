'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Mic, Trash2, Zap } from 'lucide-react';
import type { AcousticTriggerProfile } from '@shared/types';
import { UpgradeActions } from '@/components/account/PlanGate';
import { buttonStyles } from '@/components/modals/Modal';
import { inputStyles } from '@/components/modals/settings/controls';
import { useAccount } from '@/components/providers/AccountProvider';
import { useSession } from '@/components/providers/SessionProvider';
import { ShortcutField } from '@/components/ui/ShortcutField';
import { VocalAssistPanel } from '@/components/profiles/VocalAssistPanel';
import { EmptyState } from '@/components/views/EmptyState';

type Action = AcousticTriggerProfile['targetAction'];

const ACTIONS: ReadonlyArray<[Action, string, string]> = [
  ['DIRECT_PASTE', 'Type the phrase', 'into whichever app has focus'],
  ['TTS_SPOKEN', 'Speak the phrase', 'through the speakers'],
  ['WEBRTC_ALERT', 'Alert the caregiver', 'over the caregiver link'],
  ['OS_HOTKEY', 'Press a shortcut', 'the phrase is the key combination, e.g. Control+Shift+M'],
];

const CAPTURE_MS = 600;

export function TriggersView() {
  const { pipeline, live, backendOnline } = useSession();
  const { entitlements, offline } = useAccount();
  const limit = entitlements.triggerLimit;
  const atLimit = limit !== null && pipeline.triggers.length >= limit;
  const { triggers, captureTrigger, cancelTriggerCapture, removeTrigger, setTriggerThreshold } = pipeline;
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [action, setAction] = useState<Action>('TTS_SPOKEN');
  const [capturing, setCapturing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countRef = useRef(0);
  const ids = { name: useId(), phrase: useId(), action: useId() };

  // The worker reports enrolment through the trigger list; a new entry ends the capture state.
  useEffect(() => {
    if (capturing && triggers.length > countRef.current) {
      setCapturing(false);
      setName('');
      setPhrase('');
    }
    countRef.current = triggers.length;
  }, [capturing, triggers.length]);

  const startCapture = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !phrase.trim() || !live || atLimit) return;
    setCountdown(3);
    const tick = (remaining: number) => {
      if (remaining === 0) {
        setCountdown(null);
        setCapturing(true);
        countRef.current = triggers.length;
        captureTrigger({
          id: `trigger-${Date.now()}`,
          name: name.trim(),
          mappedPhrase: phrase.trim(),
          targetAction: action,
          durationMs: CAPTURE_MS,
        });
        return;
      }
      setCountdown(remaining);
      window.setTimeout(() => tick(remaining - 1), 1000);
    };
    tick(3);
  };

  const cancel = () => {
    cancelTriggerCapture();
    setCapturing(false);
    setCountdown(null);
  };

  return (
    <div className="space-y-6">
      <VocalAssistPanel />

      <section aria-labelledby="enrol-heading" className="glass rounded-2xl p-5">
        <h2 id="enrol-heading" className="text-xl font-semibold text-ink">
          Teach a gesture
        </h2>
        <p className="mt-1 max-w-prose text-mist">
          Name it, choose what it should do, then make the sound for about half a second when the countdown ends. Enrolment
          averages the spectrum of that sound; matching compares every live frame against it.
        </p>
        <form onSubmit={startCapture} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.name} className="text-sm font-bold text-mist">
              Name
            </label>
            <input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} placeholder="Low hum" className={inputStyles} required />
          </div>
          <div>
            <label htmlFor={ids.action} className="text-sm font-bold text-mist">
              Action
            </label>
            <select
              id={ids.action}
              value={action}
              onChange={(event) => {
                setAction(event.target.value as Action);
                setPhrase('');
              }}
              className={inputStyles}
            >
              {ACTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-mist">{ACTIONS.find(([value]) => value === action)?.[2]}</p>
          </div>
          <div className="sm:col-span-2">
            {action === 'OS_HOTKEY' ? (
              <ShortcutField value={phrase} onChange={setPhrase} label="Shortcut to press" hint="Click the box and press the keys, for example Ctrl + Shift + M. Escape cancels, Backspace clears." />
            ) : (
              <>
                <label htmlFor={ids.phrase} className="text-sm font-bold text-mist">
                  Phrase
                </label>
                <input id={ids.phrase} value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="I need help, please" className={inputStyles} required />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            {capturing ? (
              <>
                <span className="flex items-center gap-2 font-display text-lg font-semibold text-neon-cyan">
                  <Mic aria-hidden className="size-5 animate-pulse" />
                  Make the sound now
                </span>
                <button type="button" onClick={cancel} className={buttonStyles.secondary}>
                  Cancel
                </button>
              </>
            ) : countdown !== null ? (
              <span className="font-display text-lg font-semibold text-ink">Get ready: {countdown}</span>
            ) : (
              <button type="submit" disabled={!live || atLimit || !name.trim() || !phrase.trim()} className={buttonStyles.primary}>
                <Zap aria-hidden className="size-4" />
                Record the sound
              </button>
            )}
            {!live && <span className="text-sm text-mist">Start the microphone first.</span>}
            {(backendOnline === false || offline) && (
              <span className="text-sm text-warn">Voicematics is offline: new triggers can be saved once it reconnects.</span>
            )}
          </div>
          {atLimit && (
            <div className="sm:col-span-2">
              <p className="mb-3 text-ink">
                Your plan includes {limit} trigger{limit === 1 ? '' : 's'}. Delete one to record a different sound, or upgrade to
                Voicematics Pro for unlimited triggers.
              </p>
              <UpgradeActions compact />
            </div>
          )}
        </form>
      </section>

      {triggers.length === 0 ? (
        <EmptyState icon={Zap} title="No gestures yet">
          A gesture is a short sound you can make, like a click or a hum, linked to a phrase that gets spoken or typed for you, or a shortcut that gets pressed.
        </EmptyState>
      ) : (
        <section aria-label="Enrolled triggers" className="glass rounded-2xl">
          <ul className="divide-y divide-white/10">
            {triggers.map((trigger, index) => (
              <li key={trigger.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-ink">
                    {trigger.name}
                    {limit !== null && index >= limit && (
                      <span className="font-sans text-sm font-bold text-warn">Paused: over your plan&apos;s trigger limit</span>
                    )}
                  </p>
                  <p className="text-sm text-mist">
                    {ACTIONS.find(([value]) => value === trigger.targetAction)?.[1]}: &ldquo;{trigger.mappedPhrase}&rdquo;
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-mist">
                  Sensitivity
                  <input
                    type="range"
                    min={0.5}
                    max={0.99}
                    step={0.01}
                    defaultValue={trigger.threshold}
                    onChange={(event) => setTriggerThreshold(trigger.id, Number(event.target.value))}
                    aria-label={`Threshold for ${trigger.name}`}
                    className="accent-[#00F2FE]"
                  />
                  <span className="w-10 tabular-nums text-ink">{Math.round(trigger.threshold * 100)}%</span>
                </label>
                <button type="button" onClick={() => removeTrigger(trigger.id)} aria-label={`Delete trigger ${trigger.name}`} className="rounded-lg p-2 text-mist hover:bg-white/10 hover:text-warn">
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
