'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { AtSign, Check, ShieldCheck, UserPlus, X } from 'lucide-react';
import type { CaregiverAccessList } from '@shared/types';
import { buttonStyles } from '@/components/modals/Modal';
import { inputStyles } from '@/components/modals/settings/controls';
import { useSession } from '@/components/providers/SessionProvider';
import { api, ApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';

function describe(error: unknown): string {
  if (error instanceof ApiError && typeof error.detail === 'string') return error.detail;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The speaker's side of approval: caregivers asking right now (from the link), everyone approved (from the
 * account), and approving a username before they ask. Nobody sees anything until they are approved here.
 */
export function CaregiverApprovals() {
  const { link, decideAccess, dismissAccessRequest, backendOnline } = useSession();
  const [access, setAccess] = useState<CaregiverAccessList | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const requests = link?.accessRequests ?? [];

  const load = useCallback(() => {
    api.caregivers
      .list()
      .then((list) => {
        setAccess(list);
        setError(null);
      })
      .catch((cause: unknown) => setError(describe(cause)));
  }, []);

  // Refresh whenever a request arrives or is answered, and when the server comes back.
  useEffect(() => {
    if (backendOnline !== false) load();
  }, [backendOnline, load, requests.length, link?.peerPresent]);

  const act = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      load();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(null);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const name = username.trim().replace(/^@/, '').toLowerCase();
    if (!name) return;
    void act('add', async () => {
      await api.caregivers.add(name);
      setUsername('');
    });
  };

  const approved = access?.caregivers.filter((row) => row.status === 'approved') ?? [];
  // Requests the link raised are shown with live Approve / Deny; older pending ones come from the account.
  const livePending = new Set(requests.map((request) => request.id));
  const storedPending = access?.caregivers.filter((row) => row.status === 'pending' && !livePending.has(row.id)) ?? [];

  return (
    <section aria-labelledby="approvals-heading" className="glass rounded-2xl p-5">
      <h2 id="approvals-heading" className="flex items-center gap-2 text-xl font-semibold text-ink">
        <ShieldCheck aria-hidden className="size-5 text-neon-cyan" />
        Who can watch you
      </h2>
      <p className="mt-1 max-w-prose text-sm text-mist">
        A caregiver signs in and enters your room code, then waits here for your approval. A room code alone shows them nothing, and you can remove anyone at any time.
      </p>

      {(requests.length > 0 || storedPending.length > 0) && (
        <ul aria-live="polite" className="mt-4 space-y-2">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-neon-cyan/50 bg-neon-cyan/10 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{request.displayName || `@${request.username}`} wants to watch you</span>
                <span className="block text-sm text-mist">@{request.username} · waiting now</span>
              </span>
              <button type="button" onClick={() => decideAccess(request.id, true)} className={cn(buttonStyles.primary, 'h-9 px-3 text-sm')}>
                <Check aria-hidden className="size-4" />
                Approve
              </button>
              <button type="button" onClick={() => decideAccess(request.id, false)} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
                <X aria-hidden className="size-4" />
                Deny
              </button>
            </li>
          ))}
          {storedPending.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{row.displayName || `@${row.username}`}</span>
                <span className="block text-sm text-mist">@{row.username} · asked earlier</span>
              </span>
              <button type="button" disabled={busy !== null} onClick={() => void act(row.id, () => api.caregivers.decide(row.id, true))} className={cn(buttonStyles.primary, 'h-9 px-3 text-sm')}>
                <Check aria-hidden className="size-4" />
                Approve
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void act(row.id, () => api.caregivers.decide(row.id, false))} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
                <X aria-hidden className="size-4" />
                Deny
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <p className="text-sm font-bold text-mist">Approved</p>
        {approved.length === 0 ? (
          <p className="mt-1 text-sm text-mist">Nobody yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {approved.map((row) => (
              <li key={row.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="min-w-0 flex-1 text-ink">
                  <span className="font-semibold">{row.displayName || `@${row.username}`}</span>
                  <span className="text-sm text-mist"> @{row.username}</span>
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(row.id, async () => {
                      await api.caregivers.remove(row.id);
                      dismissAccessRequest(row.id);
                    })
                  }
                  className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor={inputId} className="text-sm font-bold text-mist">
            Approve a username before they ask
          </label>
          <div className="relative mt-1">
            <AtSign aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist" />
            <input id={inputId} value={username} onChange={(event) => setUsername(event.target.value)} maxLength={21} placeholder="their username" className={cn(inputStyles, 'pl-9')} />
          </div>
        </div>
        <button type="submit" disabled={busy !== null || !username.trim()} className={buttonStyles.primary}>
          <UserPlus aria-hidden className="size-4" />
          Approve
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-warn">
          {error}
        </p>
      )}
    </section>
  );
}
