'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, ExternalLink, RefreshCw, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { DirectPasteResult, DirectPasteState, DirectPasteStatus } from '@/types/omnivoice';
import { cn } from '@/lib/cn';

const TEST_COUNTDOWN_SECONDS = 5;

const STATE_BADGES: Record<DirectPasteState, { icon: LucideIcon; label: string; className: string }> = {
  ready: { icon: CircleCheck, label: 'Ready', className: 'text-neon-cyan' },
  'needs-permission': { icon: ShieldAlert, label: 'Needs permission', className: 'text-warn' },
  limited: { icon: TriangleAlert, label: 'Limited', className: 'text-warn' },
  unavailable: { icon: CircleX, label: 'Unavailable', className: 'text-warn' },
};

/** Shows command-line flags and environment variables (anything with `=`) as code. */
function renderStep(step: string): ReactNode {
  return step.split(/(\S+=\S+?)(?=[.,]?(?:\s|$))/).map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-[0.9em] text-neon-cyan">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function describeResult(result: DirectPasteResult): string {
  if (!result.ok) return result.message;
  const via = result.method === 'paste' ? ' through the clipboard' : '';
  return `Typed ${result.characters} characters into the active app${via}.`;
}

export function DirectPastePanel() {
  const headingId = useId();
  const inputId = useId();
  const [inDesktopApp, setInDesktopApp] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DirectPasteStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testText, setTestText] = useState('Hello from OmniVoice');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [result, setResult] = useState<DirectPasteResult | null>(null);

  const refresh = useCallback(async () => {
    const bridge = window.omnivoice;
    if (!bridge) return;
    try {
      setStatus(await bridge.directPaste.getStatus());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    setInDesktopApp(Boolean(window.omnivoice));
    void refresh();
    // Re-check when the user comes back, e.g. from System Settings.
    const handleFocus = () => void refresh();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refresh]);

  useEffect(() => {
    if (countdown === null || countdown === 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown !== 0) return;
    let cancelled = false;
    window.omnivoice?.directPaste
      .type({ text: testText, mode: 'auto' })
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        if (!next.ok && next.status) setStatus(next.status);
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ ok: false, reason: 'failed', message: String(error) });
      })
      .finally(() => {
        if (!cancelled) setCountdown(null);
      });
    return () => {
      cancelled = true;
    };
  }, [countdown, testText]);

  const requestPermission = async () => {
    const bridge = window.omnivoice;
    if (bridge) setStatus(await bridge.directPaste.requestPermission());
  };

  const badge = status ? STATE_BADGES[status.state] : null;
  const testing = countdown !== null;

  return (
    <section aria-labelledby={headingId} className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl font-semibold text-ink">
            Direct paste
          </h2>
          <p className="mt-1 max-w-prose text-mist">
            Types your words into Slack, Word, Zoom, Discord, or whichever app you are using.
          </p>
        </div>
        {badge && (
          <p className={cn('flex items-center gap-2 font-display font-semibold', badge.className)}>
            <badge.icon aria-hidden className="size-5" />
            {badge.label}
          </p>
        )}
      </div>

      {inDesktopApp === false && (
        <p className="mt-4 text-mist">Direct paste works in the desktop app. You are viewing OmniVoice OS in a browser.</p>
      )}
      {loadError && <p className="mt-4 text-warn">Could not check direct paste: {loadError}</p>}

      {status && status.state !== 'ready' && (
        <div className="mt-4 rounded-xl border border-warn/50 bg-warn/[0.07] p-4">
          <h3 className="font-display text-lg font-semibold text-ink">{status.title}</h3>
          <p className="mt-1 max-w-prose text-mist">{status.message}</p>
          {status.steps.length > 0 && (
            <ol className="mt-3 max-w-prose list-decimal space-y-1.5 pl-5 text-ink marker:text-mist">
              {status.steps.map((step) => (
                <li key={step}>{renderStep(step)}</li>
              ))}
            </ol>
          )}
          {status.canRequestPermission && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void requestPermission()}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-neon-cyan px-4 font-display font-semibold text-void transition-colors hover:bg-[#5FF7FF]"
              >
                <ExternalLink aria-hidden className="size-4" />
                Open System Settings
              </button>
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/[0.12] px-4 font-display font-semibold text-ink transition-colors hover:bg-white/10"
              >
                <RefreshCw aria-hidden className="size-4" />
                Check again
              </button>
            </div>
          )}
        </div>
      )}

      {status?.state === 'ready' && <p className="mt-4 max-w-prose text-mist">{status.message}</p>}

      {status && status.state !== 'unavailable' && (
        <div className="mt-5 border-t border-white/10 pt-5">
          <h3 className="text-base font-semibold text-ink">Try it</h3>
          <p className="mt-1 max-w-prose text-sm text-mist">
            Start the test, then switch to the app you want to type into before the countdown ends.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <label htmlFor={inputId} className="sr-only">
              Text to type
            </label>
            <input
              id={inputId}
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              disabled={testing}
              className="h-10 min-w-[12rem] flex-1 rounded-lg border border-white/[0.12] bg-black/30 px-3 text-ink placeholder:text-dim disabled:opacity-60"
            />
            {testing ? (
              <button
                type="button"
                onClick={() => setCountdown(null)}
                disabled={countdown === 0}
                className="inline-flex h-10 items-center rounded-lg border border-white/[0.12] px-4 font-display font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-60"
              >
                Cancel test
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setCountdown(TEST_COUNTDOWN_SECONDS);
                }}
                disabled={testText.trim().length === 0}
                className="inline-flex h-10 items-center rounded-lg bg-neon-cyan px-4 font-display font-semibold text-void transition-colors hover:bg-[#5FF7FF] disabled:opacity-60"
              >
                Start {TEST_COUNTDOWN_SECONDS} second test
              </button>
            )}
          </div>
          <p aria-live="polite" className={cn('mt-3 min-h-6 text-sm', result && !result.ok ? 'text-warn' : 'text-mist')}>
            {countdown !== null && countdown > 0
              ? `Switch to your app now. Typing in ${countdown} s.`
              : countdown === 0
                ? 'Typing now.'
                : result
                  ? describeResult(result)
                  : ''}
          </p>
        </div>
      )}
    </section>
  );
}
