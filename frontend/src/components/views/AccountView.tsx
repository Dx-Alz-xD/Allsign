'use client';

import { useId, useState, type FormEvent } from 'react';
import { Check, Copy, ExternalLink, Eye, EyeOff, LogOut, RefreshCw, Trash, WifiOff } from 'lucide-react';
import type { Feature } from '@shared/types';
import { ProBadge, UpgradeActions } from '@/components/account/PlanGate';
import { buttonStyles } from '@/components/modals/Modal';
import { inputStyles } from '@/components/modals/settings/controls';
import { useAccount } from '@/components/providers/AccountProvider';
import { FEATURE_NAMES, PLAN_NAMES, openWebsite } from '@/lib/account/plans';
import { cn } from '@/lib/cn';

const ALL_FEATURES: readonly Feature[] = [
  'clearvoice',
  'aphasia',
  'sensory',
  'vocal_assist',
  'fluency',
  'therapy',
  'unlimited_triggers',
  'caregiver_link',
  'analytics',
  'clinical_reports',
];

const STORAGE_TEXT = {
  keychain: 'Kept encrypted with your system keychain.',
  'file-only': 'Kept in a file only your user account can read. No system keyring is running, so it is not encrypted.',
  'memory-only': 'Not kept on this computer. You sign in each time Voicematics starts.',
  browser: 'Kept in this browser’s storage.',
} as const;

function DeleteAccount() {
  const { deleteAccount, offline } = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="account-delete" className="glass rounded-2xl p-5">
      <h2 id="account-delete" className="text-xl font-semibold text-ink">
        Delete account
      </h2>
      <p className="mt-1 max-w-prose text-mist">
        Erases your account, licence and plan, and every trigger, preset, session and therapy target saved with it. This
        cannot be undone.
      </p>
      {confirming ? (
        <form onSubmit={submit} className="mt-4 rounded-xl border border-warn/60 bg-warn/[0.07] p-4">
          <label htmlFor={passwordId} className="text-sm font-bold text-ink">
            Enter your password to delete your account
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={cn(inputStyles, 'mt-1 max-w-sm')}
          />
          {error && (
            <p role="alert" className="mt-2 text-warn">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !password} className={buttonStyles.danger}>
              <Trash aria-hidden className="size-4" />
              {busy ? 'Deleting' : 'Delete my account'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={buttonStyles.secondary}>
              Keep my account
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} disabled={offline} className={cn(buttonStyles.secondary, 'mt-4')}>
          <Trash aria-hidden className="size-4" />
          Delete account
        </button>
      )}
    </section>
  );
}

function formatDate(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;
}

function maskKey(key: string): string {
  return key.replace(/^(VM)-\w{4}-\w{4}-(\w{4})$/, '$1-••••-••••-$2');
}

export function AccountView() {
  const { email, account, entitlements, planEntitlements, licence, licenceElsewhere, offline, refreshedAt, storage, refresh, signOut } =
    useAccount();
  const [revealKey, setRevealKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'refresh' | 'sign-out' | 'free' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = account?.license?.key ?? null;
  const expires = formatDate(planEntitlements.expiresAt);
  const planLine =
    planEntitlements.tier === 'free'
      ? 'Free plan. Upgrade on the website for the Fluency Coach, Therapy Mode, the Caregiver Link, analytics and more.'
      : planEntitlements.tier === 'lifetime'
        ? 'Lifetime access. Every future release is included.'
        : expires
          ? `Pro plan, paid through ${expires}.`
          : 'Pro plan.';

  const thisComputer = !licence
    ? offline
      ? 'Not checked yet: Voicematics is offline.'
      : 'Checking the licence for this computer.'
    : licence.status === 'hardware_mismatch'
      ? 'Your licence is active on another computer.'
      : licence.status === 'active'
        ? licence.hardwareBound
          ? 'Your licence is active on this computer.'
          : 'Your licence is not tied to a computer yet.'
        : 'Your licence is not active. Sign in on the website to check your account.';

  const run = async (kind: 'refresh' | 'sign-out' | 'free') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'refresh') await refresh();
      else await signOut({ freeLicence: kind === 'free' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const copyKey = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setRevealKey(true);
    }
  };

  return (
    <div className="space-y-6">
      {offline && (
        <p role="status" className="glass flex items-start gap-3 rounded-2xl px-5 py-4 text-ink">
          <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          <span>
            Voicematics cannot reach its server right now. Your plan as last confirmed
            {refreshedAt ? ` on ${formatDate(refreshedAt)}` : ''} still applies, and saving triggers or sessions waits until
            you are back online.
          </span>
        </p>
      )}

      <section aria-labelledby="account-plan" className="rounded-3xl bg-neon-edge p-px shadow-neon">
        <div className="rounded-[calc(1.5rem-1px)] bg-void/90 p-6 backdrop-blur-xl sm:p-8">
          <p className="break-all text-mist">{email}</p>
          <h2 id="account-plan" className="mt-1 text-3xl font-bold text-ink sm:text-4xl">
            Voicematics {PLAN_NAMES[planEntitlements.tier]}
          </h2>
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-mist">{planLine}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => openWebsite('#pricing')} className={buttonStyles.primary}>
              <ExternalLink aria-hidden className="size-4" />
              {planEntitlements.tier === 'free' ? 'See plans' : 'Manage plan on the website'}
            </button>
            <button type="button" onClick={() => void run('refresh')} disabled={busy !== null} className={buttonStyles.secondary}>
              <RefreshCw aria-hidden className={cn('size-4', busy === 'refresh' && 'animate-spin motion-reduce:animate-none')} />
              Check plan now
            </button>
          </div>
          {refreshedAt && !offline && (
            <p className="mt-3 text-sm text-mist">Last confirmed {new Date(refreshedAt).toLocaleString()}.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="account-features" className="glass rounded-2xl p-5">
        <h2 id="account-features" className="text-xl font-semibold text-ink">
          What this computer can use
        </h2>
        <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {ALL_FEATURES.map((feature) => {
            const included = entitlements.features.includes(feature);
            return (
              <li key={feature} className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-2">
                <span className={included ? 'text-ink' : 'text-mist'}>{FEATURE_NAMES[feature]}</span>
                {included ? (
                  <span className="flex items-center gap-1 text-sm text-neon-cyan">
                    <Check aria-hidden className="size-4" />
                    Included
                  </span>
                ) : (
                  <ProBadge />
                )}
              </li>
            );
          })}
        </ul>
        {entitlements.triggerLimit !== null && (
          <p className="mt-3 text-sm text-mist">
            Your plan includes {entitlements.triggerLimit} acoustic trigger{entitlements.triggerLimit === 1 ? '' : 's'}.
          </p>
        )}
        {entitlements.tier === 'free' && (
          <div className="mt-4">
            <UpgradeActions compact />
          </div>
        )}
      </section>

      <section aria-labelledby="account-licence" className="glass rounded-2xl p-5">
        <h2 id="account-licence" className="text-xl font-semibold text-ink">
          Licence and this computer
        </h2>
        {key ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-display text-lg tracking-wider text-ink">
              {revealKey ? key : maskKey(key)}
            </code>
            <button
              type="button"
              onClick={() => setRevealKey((shown) => !shown)}
              aria-pressed={revealKey}
              className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}
            >
              {revealKey ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
              {revealKey ? 'Hide key' : 'Show key'}
            </button>
            <button type="button" onClick={() => void copyKey()} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
              {copied ? 'Copied' : 'Copy key'}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-mist">This account has no licence key.</p>
        )}
        <p className="mt-3 text-ink">{thisComputer}</p>
        {licenceElsewhere && (
          <div className="mt-3">
            <UpgradeActions compact />
          </div>
        )}
        <p className="mt-3 text-sm text-mist">
          {storage ? STORAGE_TEXT[storage] : ''} Your password is never stored; this computer keeps a sign-in token that works
          only here.
        </p>
      </section>

      <section aria-labelledby="account-sign-out" className="glass rounded-2xl p-5">
        <h2 id="account-sign-out" className="text-xl font-semibold text-ink">
          Sign out
        </h2>
        <p className="mt-1 max-w-prose text-mist">
          Signing out removes the account from this computer. Your triggers, presets and session history stay with your
          account. To use your licence on a different computer, free it here first.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void run('sign-out')} disabled={busy !== null} className={buttonStyles.secondary}>
            <LogOut aria-hidden className="size-4" />
            {busy === 'sign-out' ? 'Signing out' : 'Sign out'}
          </button>
          {licence?.status === 'active' && licence.hardwareBound && (
            <button type="button" onClick={() => void run('free')} disabled={busy !== null || offline} className={buttonStyles.secondary}>
              <LogOut aria-hidden className="size-4" />
              {busy === 'free' ? 'Freeing licence' : 'Free the licence and sign out'}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-warn">
            {error}
          </p>
        )}
      </section>

      <DeleteAccount />
    </div>
  );
}
