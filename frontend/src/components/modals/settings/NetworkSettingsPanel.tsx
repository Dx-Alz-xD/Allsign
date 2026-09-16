'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { FieldError, SettingSection, inputStyles } from '@/components/modals/settings/controls';
import { useSettings } from '@/components/providers/SettingsProvider';
import {
  probeNetworkSettings,
  serverHost,
  validateNetworkSettings,
  type ProbeResult,
} from '@/lib/settings/network';
import { defaultNetworkSettings, type NetworkSettings } from '@/lib/settings/schema';
import { cn } from '@/lib/cn';

interface Draft {
  stunText: string;
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
}

const toDraft = (settings: NetworkSettings): Draft => ({
  stunText: settings.stunUrls.join('\n'),
  turnUrl: settings.turnUrl,
  turnUsername: settings.turnUsername,
  turnCredential: settings.turnCredential,
});

const fromDraft = (draft: Draft): NetworkSettings => ({
  stunUrls: draft.stunText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
  turnUrl: draft.turnUrl.trim(),
  turnUsername: draft.turnUsername.trim(),
  turnCredential: draft.turnCredential,
});

const PROBE_TEXT: Record<ProbeResult, { text: string; tone: 'good' | 'bad' | 'neutral' }> = {
  working: { text: 'Working', tone: 'good' },
  'no-response': { text: 'No response within 6 seconds', tone: 'bad' },
  'not-configured': { text: 'Not configured', tone: 'neutral' },
  error: { text: 'Could not start the test. Check the address.', tone: 'bad' },
};

export function NetworkSettingsPanel() {
  const { settings, updateNetwork } = useSettings();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings.network));
  const [showErrors, setShowErrors] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<{ stun: ProbeResult; turn: ProbeResult; turnHost: string } | null>(null);
  const ids = { stun: useId(), turnUrl: useId(), username: useId(), credential: useId() };

  useEffect(() => setDraft(toDraft(settings.network)), [settings.network]);

  const candidate = fromDraft(draft);
  const validation = validateNetworkSettings(candidate);
  const dirty = JSON.stringify(candidate) !== JSON.stringify(settings.network);
  const stunErrors = validation.stun.filter((entry) => entry.error);
  const edit = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (!validation.valid) {
      setMessage('Fix the highlighted fields, then save again.');
      return;
    }
    updateNetwork(candidate);
    setShowErrors(false);
    setMessage('Saved on this device.');
  };

  const runTest = async () => {
    setShowErrors(true);
    if (!validation.valid) {
      setMessage('Fix the highlighted fields before testing.');
      return;
    }
    setTesting(true);
    setProbe(null);
    setMessage('Testing servers…');
    try {
      const result = await probeNetworkSettings(candidate);
      setProbe({ ...result, turnHost: candidate.turnUrl ? serverHost(candidate.turnUrl) : '' });
      setMessage('Test finished.');
    } finally {
      setTesting(false);
    }
  };

  const errorFor = (value: string | null) => (showErrors ? value : null);

  return (
    <form onSubmit={submit} noValidate className="space-y-10">
      <SettingSection
        title="Connection helper (STUN)"
        description="Lets Voicematics find a direct path to a caregiver's device. It sees your public IP address, nothing else."
      >
        <div>
          <label htmlFor={ids.stun} className="mb-1.5 block font-semibold text-ink">
            STUN servers, one per line
          </label>
          <textarea
            id={ids.stun}
            rows={3}
            value={draft.stunText}
            onChange={(event) => edit({ stunText: event.target.value })}
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={showErrors && stunErrors.length > 0}
            aria-describedby={showErrors && stunErrors.length > 0 ? `${ids.stun}-error` : undefined}
            placeholder="stun:stun.l.google.com:19302"
            className={cn(inputStyles, 'font-mono text-sm')}
          />
          {showErrors && stunErrors.length > 0 && (
            <FieldError id={`${ids.stun}-error`}>
              {stunErrors.map((entry) => `${entry.url}: ${entry.error}`).join(' ')}
            </FieldError>
          )}
        </div>
      </SettingSection>

      <SettingSection
        title="Relay server (TURN)"
        description="Used only when a direct connection is blocked. The relay forwards encrypted data and can see connection details. Leave empty to never relay."
      >
        <div className="space-y-4">
          <div>
            <label htmlFor={ids.turnUrl} className="mb-1.5 block font-semibold text-ink">
              TURN server
            </label>
            <input
              id={ids.turnUrl}
              value={draft.turnUrl}
              onChange={(event) => edit({ turnUrl: event.target.value })}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={Boolean(errorFor(validation.turnUrl))}
              aria-describedby={errorFor(validation.turnUrl) ? `${ids.turnUrl}-error` : undefined}
              placeholder="turn:relay.example.com:3478?transport=udp"
              className={cn(inputStyles, 'font-mono text-sm')}
            />
            {errorFor(validation.turnUrl) && <FieldError id={`${ids.turnUrl}-error`}>{validation.turnUrl}</FieldError>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={ids.username} className="mb-1.5 block font-semibold text-ink">
                Username
              </label>
              <input
                id={ids.username}
                value={draft.turnUsername}
                onChange={(event) => edit({ turnUsername: event.target.value })}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                aria-invalid={Boolean(errorFor(validation.turnUsername))}
                aria-describedby={errorFor(validation.turnUsername) ? `${ids.username}-error` : undefined}
                className={inputStyles}
              />
              {errorFor(validation.turnUsername) && (
                <FieldError id={`${ids.username}-error`}>{validation.turnUsername}</FieldError>
              )}
            </div>
            <div>
              <label htmlFor={ids.credential} className="mb-1.5 block font-semibold text-ink">
                Password or credential
              </label>
              <div className="flex gap-2">
                <input
                  id={ids.credential}
                  type={showCredential ? 'text' : 'password'}
                  value={draft.turnCredential}
                  onChange={(event) => edit({ turnCredential: event.target.value })}
                  autoComplete="off"
                  aria-invalid={Boolean(errorFor(validation.turnCredential))}
                  aria-describedby={`${ids.credential}-hint${errorFor(validation.turnCredential) ? ` ${ids.credential}-error` : ''}`}
                  className={inputStyles}
                />
                <button
                  type="button"
                  onClick={() => setShowCredential((value) => !value)}
                  aria-pressed={showCredential}
                  aria-label="Show password"
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/15 text-mist transition-colors hover:bg-white/10 hover:text-ink"
                >
                  {showCredential ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                </button>
              </div>
              <p id={`${ids.credential}-hint`} className="mt-1.5 text-sm text-mist">
                Saved only on this device and left out of data exports.
              </p>
              {errorFor(validation.turnCredential) && (
                <FieldError id={`${ids.credential}-error`}>{validation.turnCredential}</FieldError>
              )}
            </div>
          </div>
        </div>
      </SettingSection>

      {probe && (
        <section aria-label="Test results" className="rounded-xl border border-white/10">
          <dl className="divide-y divide-white/10">
            {[
              { label: 'STUN', result: probe.stun },
              { label: probe.turnHost ? `TURN relay (${probe.turnHost})` : 'TURN relay', result: probe.turn },
            ].map(({ label, result }) => {
              const text = PROBE_TEXT[result];
              return (
                <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <dt className="font-semibold text-ink">{label}</dt>
                  <dd
                    className={cn(
                      'font-bold',
                      text.tone === 'good' ? 'text-neon-cyan' : text.tone === 'bad' ? 'text-warn' : 'text-mist',
                    )}
                  >
                    {result === 'no-response' && label.startsWith('TURN') ? 'No relay. Check the address and credentials.' : text.text}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!dirty} className={buttonStyles.primary}>
          Save network settings
        </button>
        <button type="button" onClick={() => void runTest()} disabled={testing} className={buttonStyles.secondary}>
          {testing && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
          {testing ? 'Testing…' : 'Test servers'}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(toDraft(defaultNetworkSettings()));
            setShowErrors(false);
            setMessage('Defaults restored. Save to keep them.');
          }}
          className={buttonStyles.secondary}
        >
          Restore defaults
        </button>
        <p aria-live="polite" className="min-h-6 w-full text-sm text-mist sm:ml-2 sm:w-auto">
          {message || (dirty ? 'You have unsaved changes.' : '')}
        </p>
      </div>
    </form>
  );
}
