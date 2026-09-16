'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Copy, Keyboard } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import type { HotkeyRegistration, HotkeyStatus } from '@/types/omnivoice';
import { cn } from '@/lib/cn';

function registrationState(registration: HotkeyRegistration): { label: string; className: string } {
  if (!registration.registered) return { label: 'Taken by another app', className: 'text-warn' };
  if (!registration.verified) return { label: 'Needs desktop approval', className: 'text-warn' };
  return { label: 'Active', className: 'text-neon-cyan' };
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex w-full items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-lg bg-black/40 px-3 py-2 text-sm text-neon-cyan">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.12] px-3 text-sm font-bold text-ink transition-colors hover:bg-white/10"
      >
        {copied ? <Check aria-hidden className="size-4 text-neon-cyan" /> : <Copy aria-hidden className="size-4" />}
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

export function HotkeyPanel() {
  const headingId = useId();
  const [inDesktopApp, setInDesktopApp] = useState<boolean | null>(null);
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { openModal } = useModals();

  useEffect(() => {
    const bridge = window.omnivoice;
    setInDesktopApp(Boolean(bridge));
    if (!bridge) return;
    bridge.hotkeys
      .getStatus()
      .then(setStatus)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
    return bridge.hotkeys.onChange(setStatus);
  }, []);

  return (
    <section aria-labelledby={headingId} className="glass rounded-2xl p-5">
      <h2 id={headingId} className="text-xl font-semibold text-ink">
        Global shortcuts
      </h2>
      <p className="mt-1 max-w-prose text-mist">These work from any app, even when Voicematics is in the background.</p>
      {inDesktopApp && (
        <button type="button" onClick={() => openModal({ kind: 'settings', tab: 'shortcuts' })} className={`${buttonStyles.secondary} mt-4`}>
          <Keyboard aria-hidden className="size-4" />
          Change shortcuts
        </button>
      )}

      {inDesktopApp === false && <p className="mt-4 text-mist">Global shortcuts work in the desktop app.</p>}
      {loadError && <p className="mt-4 text-warn">Could not read shortcut status: {loadError}</p>}

      {status && (
        <>
          {status.note && <p className="mt-4 max-w-prose rounded-xl border border-warn/50 bg-warn/[0.07] p-3 text-ink">{status.note}</p>}
          <ul className="mt-4 divide-y divide-white/10">
            {status.registrations.map((registration) => {
              const state = registrationState(registration);
              const needsFallback = !registration.registered || !registration.verified;
              return (
                <li key={registration.action} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                  <span className="font-semibold text-ink">{registration.label}</span>
                  <span className="flex flex-wrap items-center gap-3">
                    <kbd className="flex items-center gap-1 font-sans">
                      {registration.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded-md border border-white/20 bg-white/[0.06] px-2 py-0.5 font-display text-sm font-semibold text-ink"
                        >
                          {key}
                        </kbd>
                      ))}
                    </kbd>
                    <span className={cn('text-sm font-bold', state.className)}>{state.label}</span>
                  </span>
                  {needsFallback && registration.triggerCommand && <CopyCommand command={registration.triggerCommand} />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
