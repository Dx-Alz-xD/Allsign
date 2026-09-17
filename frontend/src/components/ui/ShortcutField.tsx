'use client';

import { useEffect, useId, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { acceleratorFromKeyboardEvent, displayAcceleratorKeys } from '../../../electron/accelerator';
import { buttonStyles } from '@/components/modals/Modal';
import { cn } from '@/lib/cn';

interface ShortcutFieldProps {
  value: string;
  onChange: (accelerator: string) => void;
  label: string;
  /** For the gesture shortcut the key combination is the whole phrase; nothing else may be typed. */
  hint?: string;
}

/**
 * A field that is set by pressing the keys, the way a game's key binding is. Click it (or focus it and press
 * Enter), then press the combination; Escape cancels, Backspace clears.
 */
export function ShortcutField({ value, onChange, label, hint }: ShortcutFieldProps) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const platform = typeof window !== 'undefined' ? (window.omnivoice?.platform ?? 'win32') : 'win32';
  const keys = value ? displayAcceleratorKeys(value, platform) : [];

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      if (plain && event.key === 'Tab') {
        setRecording(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (plain && event.key === 'Escape') {
        setRecording(false);
        return;
      }
      if (plain && (event.key === 'Backspace' || event.key === 'Delete')) {
        onChange('');
        setRecording(false);
        return;
      }
      const recorded = acceleratorFromKeyboardEvent(event, platform);
      setHeld(recorded.heldKeys);
      if (recorded.unsupportedKey) {
        setProblem('That key cannot be part of a shortcut. Use a letter, number or function key with the modifiers.');
        return;
      }
      if (!recorded.accelerator) return;
      setProblem(null);
      onChange(recorded.accelerator);
      setRecording(false);
    };
    const onKeyUp = (event: KeyboardEvent) => setHeld(acceleratorFromKeyboardEvent(event, platform).heldKeys);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      setHeld([]);
    };
  }, [recording, onChange, platform]);

  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-mist">
        {label}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          id={id}
          type="button"
          onClick={() => setRecording(true)}
          aria-pressed={recording}
          aria-describedby={`${id}-hint`}
          className={cn(
            'flex h-11 min-w-[14rem] items-center gap-2 rounded-lg border px-3 text-left font-mono text-ink transition-colors',
            recording ? 'border-neon-cyan bg-neon-cyan/10 shadow-neon-soft' : 'border-white/15 bg-black/30 hover:border-neon-cyan/40',
          )}
        >
          <Keyboard aria-hidden className="size-4 shrink-0 text-mist" />
          {recording ? (
            <span className="text-mist">{held.length > 0 ? `${held.join(' + ')} + …` : 'Press the keys now'}</span>
          ) : keys.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {keys.map((key, index) => (
                <kbd key={`${key}-${index}`} className="rounded border border-white/20 bg-white/[0.06] px-1.5 py-0.5 text-sm">
                  {key}
                </kbd>
              ))}
            </span>
          ) : (
            <span className="text-mist">Click, then press a key combination</span>
          )}
        </button>
        {value && !recording && (
          <button type="button" onClick={() => onChange('')} aria-label="Clear shortcut" className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <p id={`${id}-hint`} className={cn('mt-1 text-sm', problem ? 'text-warn' : 'text-mist')}>
        {problem ?? hint ?? 'Escape cancels, Backspace clears.'}
      </p>
    </div>
  );
}
