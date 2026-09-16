'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Siren, Volume2 } from 'lucide-react';

export const EMERGENCY_PHRASE = 'I need help now.';

interface EmergencyAlertDialogProps {
  open: boolean;
  onClose: () => void;
}

export function EmergencyAlertDialog({ open, onClose }: EmergencyAlertDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const speak = useCallback(() => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(EMERGENCY_PHRASE);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the repeat button first so an accidental Enter replays the phrase instead of dismissing it.
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    speak();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const buttons = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button'));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      previouslyFocused?.focus();
    };
  }, [open, onClose, speak]);

  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="emergency-alert"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[90] grid place-items-center bg-void/90 p-4 backdrop-blur-sm"
        >
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-2xl rounded-3xl border-2 border-warn bg-[#1A1508] p-6 shadow-2xl shadow-black/60 sm:p-10"
          >
            <p className="flex items-center gap-3 font-display text-lg font-semibold text-warn">
              <Siren aria-hidden className="size-7" />
              Emergency alert
            </p>
            <h2 id={titleId} className="mt-4 font-display text-5xl font-bold leading-tight text-ink sm:text-7xl">
              {EMERGENCY_PHRASE}
            </h2>
            <div id={descriptionId} className="mt-6 space-y-2 text-lg leading-relaxed">
              <p className="text-mist">Show this screen to someone nearby{canSpeak ? ' or play it aloud' : ''}.</p>
              <p className="font-semibold text-warn">
                No caregiver was notified. Caregiver alerts start working once the caregiver link is set up.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              {canSpeak && (
                <button
                  type="button"
                  onClick={speak}
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-warn px-5 font-display text-lg font-semibold text-void transition-colors hover:bg-[#FFD684]"
                >
                  <Volume2 aria-hidden className="size-5" />
                  Say it aloud
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-12 items-center rounded-xl border border-white/20 px-5 font-display text-lg font-semibold text-ink transition-colors hover:bg-white/10"
              >
                Close alert
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
