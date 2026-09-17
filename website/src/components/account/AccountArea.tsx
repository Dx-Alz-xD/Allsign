'use client';

/**
 * The signed-in profile: who you are to others (display name and username), your plan and desktop licence, your
 * interview answers and what they suggest, who may watch you and whom you watch, and the account itself.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AtSign,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  Crown,
  Download,
  Eye,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import type { CaregiverAccessList, CaregiverAllowance } from '@shared/types';
import { Modal } from '@/components/Modal';
import { Avatar } from '@/components/site/BrandMark';
import { useAuthFlow } from '@/components/site/SiteProviders';
import { ApiError, api } from '@/lib/api';
import { INSTALLER_URL } from '@/lib/help/guide';
import { EXPERIENCE_CHOICES, GOAL_CHOICES, PLACE_CHOICES, ROLE_CHOICES, SPEECH_CHOICES, labelOf, recommend } from '@/lib/onboarding';
import { formatPrice } from '@/lib/plans';
import { useSession } from '@/lib/session';

const TIER_LABEL = { free: 'Free', pro: 'Pro', lifetime: 'Lifetime' } as const;
const TIER_ICON = { free: Sparkles, pro: Zap, lifetime: Crown } as const;
const PERIOD_LABEL = { monthly: 'a month', annual: 'a year', lifetime: 'once' } as const;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$/;

function Card({ title, icon: Icon, children, action }: { title: string; icon: typeof UserRound; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-bone">
          <Icon aria-hidden className="size-5 text-ember" />
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-2.5 text-sm last:border-0">
      <dt className="text-smoke">{label}</dt>
      <dd className="text-right text-bone">{value}</dd>
    </div>
  );
}

export function AccountArea() {
  const session = useSession();
  const { openSignIn, openSignUp } = useAuthFlow();

  if (!session.ready) {
    return (
      <p className="panel p-6 text-smoke" aria-live="polite">
        {session.waking ? 'Waking the Voicematics server. This can take up to a minute.' : 'Loading your profile…'}
      </p>
    );
  }
  if (!session.account || !session.token) {
    return (
      <section className="panel mx-auto max-w-xl p-8 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-ember/15 ring-1 ring-ember/40">
          <UserRound aria-hidden className="size-7 text-ember" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold text-bone">Your profile lives here</h1>
        <p className="mt-2 text-smoke">Sign in to see your plan, your licence key, your caregivers and your answers.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={openSignIn} className="btn-primary">
            <LogIn aria-hidden className="size-4" />
            Sign in
          </button>
          <button type="button" onClick={openSignUp} className="btn-secondary">
            <Sparkles aria-hidden className="size-4 text-ember" />
            Create an account
          </button>
        </div>
      </section>
    );
  }
  return <Profile />;
}

function Profile() {
  const session = useSession();
  const account = session.account!;
  const token = session.token!;
  const profile = account.profile;
  const name = profile?.displayName || profile?.username || account.user.email;
  const TierIcon = TIER_ICON[account.entitlements.tier];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-onyx p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-ember/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-ember">Your profile</p>
            <h1 className="mt-1 truncate font-display text-3xl font-bold text-bone sm:text-4xl">{name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-smoke">
              {profile && <span className="text-bone">@{profile.username}</span>}
              <span>{account.user.email}</span>
              <span className="badge">
                <TierIcon aria-hidden className="size-3.5 text-ember" />
                {TIER_LABEL[account.entitlements.tier]}
              </span>
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <IdentityCard />
        <PlanCard />
        <CaregiversCard token={token} />
        <AnswersCard />
        <AccountCard />
      </div>
    </div>
  );
}

type UsernameState = { status: 'same' } | { status: 'checking' } | { status: 'ok' } | { status: 'bad'; reason: string };

function IdentityCard() {
  const session = useSession();
  const profile = session.account?.profile;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [usernameState, setUsernameState] = useState<UsernameState>({ status: 'same' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDisplayName(profile?.displayName ?? '');
    setUsername(profile?.username ?? '');
  }, [editing, profile?.displayName, profile?.username]);

  useEffect(() => {
    const candidate = username.trim().toLowerCase();
    if (!editing || candidate === profile?.username) {
      setUsernameState({ status: 'same' });
      return;
    }
    if (!USERNAME_PATTERN.test(candidate)) {
      setUsernameState({ status: 'bad', reason: '3 to 20 letters, digits, dots or underscores, starting and ending with a letter or digit.' });
      return;
    }
    setUsernameState({ status: 'checking' });
    const timer = window.setTimeout(() => {
      api.profile
        .usernameAvailable(candidate)
        .then((result) => setUsernameState(result.available ? { status: 'ok' } : { status: 'bad', reason: result.reason ?? 'Not available.' }))
        .catch(() => setUsernameState({ status: 'same' }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [editing, profile?.username, username]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const candidate = username.trim().toLowerCase();
      await session.updateProfile({ displayName: displayName.trim(), ...(candidate !== profile?.username ? { username: candidate } : {}) });
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Name and username"
      icon={AtSign}
      action={
        !editing && (
          <button type="button" onClick={() => setEditing(true)} className="btn-secondary px-3 py-2 normal-case tracking-normal">
            <Pencil aria-hidden className="size-4" />
            Edit
          </button>
        )
      }
    >
      {editing ? (
        <form onSubmit={save} className="space-y-4">
          <div>
            <label htmlFor="profile-name" className="label">
              Display name
            </label>
            <input id="profile-name" value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} className="field" />
          </div>
          <div>
            <label htmlFor="profile-username" className="label">
              Username
            </label>
            <div className="relative">
              <AtSign aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-smoke" />
              <input id="profile-username" value={username} maxLength={20} onChange={(event) => setUsername(event.target.value.toLowerCase())} aria-describedby="profile-username-status" className="field pl-9" />
            </div>
            <p id="profile-username-status" className={`mt-1 flex items-center gap-1.5 text-xs ${usernameState.status === 'bad' ? 'text-crimson' : usernameState.status === 'ok' ? 'text-ember' : 'text-smoke'}`} aria-live="polite">
              {usernameState.status === 'checking' && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              {usernameState.status === 'ok' && <CircleCheck aria-hidden className="size-3.5" />}
              {usernameState.status === 'bad' && <CircleX aria-hidden className="size-3.5" />}
              {usernameState.status === 'same' && 'Changing it means caregivers you approved keep access; people you asked will see the new name.'}
              {usernameState.status === 'checking' && 'Checking'}
              {usernameState.status === 'ok' && 'Available'}
              {usernameState.status === 'bad' && usernameState.reason}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-crimson">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || usernameState.status === 'bad' || usernameState.status === 'checking'} className="btn-primary px-4 py-2.5">
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="btn-secondary px-4 py-2.5">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl>
            <Row label="Display name" value={profile?.displayName || <span className="text-smoke">Not set</span>} />
            <Row label="Username" value={profile ? `@${profile.username}` : '—'} />
            <Row label="Email" value={session.account?.user.email} />
            <Row label="Member since" value={session.account ? new Date(session.account.user.createdAt).toLocaleDateString() : '—'} />
          </dl>
          <p className="mt-3 text-sm text-smoke">Your username is what a speaker approves when you ask to watch them, and what you share with your own caregivers.</p>
          {saved && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-ember" aria-live="polite">
              <CircleCheck aria-hidden className="size-4" />
              Saved
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function PlanCard() {
  const { account, subscription, token, applyAccount } = useSession();
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  if (!account) return null;

  const cancel = async () => {
    if (!token) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await api.billing.cancel(token);
      applyAccount(account, updated);
    } catch (failure) {
      setCancelError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCancelling(false);
    }
  };
  const tier = account.entitlements.tier;
  const license = account.license;

  const copy = async () => {
    if (!license) return;
    try {
      await navigator.clipboard.writeText(license.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card
      title="Plan and licence"
      icon={KeyRound}
      action={
        tier !== 'lifetime' && (
          <Link href="/#pricing" className="btn-secondary px-3 py-2 normal-case tracking-normal">
            <Zap aria-hidden className="size-4 text-ember" />
            {tier === 'free' ? 'Upgrade' : 'Go lifetime'}
          </Link>
        )
      }
    >
      <dl>
        <Row label="Plan" value={TIER_LABEL[tier]} />
        {subscription ? (
          <>
            <Row label="Billing" value={`${formatPrice(subscription.amountCents)} ${PERIOD_LABEL[subscription.billingPeriod]}`} />
            <Row label="Card" value={`${subscription.cardBrand} •••• ${subscription.cardLast4}`} />
            <Row label={subscription.currentPeriodEnd ? (subscription.status === 'cancelled' ? 'Ends' : 'Renews') : 'Access'} value={subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : 'Lifetime'} />
          </>
        ) : (
          <Row label="Billing" value="No subscription" />
        )}
        {license && <Row label="Computer" value={license.hardwareBound ? `Activated ${license.activatedAt ? new Date(license.activatedAt).toLocaleDateString() : ''}` : 'Not activated yet'} />}
      </dl>
      {subscription && subscription.billingPeriod !== 'lifetime' && (
        <div className="mt-3">
          {subscription.status === 'cancelled' ? (
            <p className="text-sm text-smoke">Renewal is off. Pro stays until the date above, then the account returns to Free.</p>
          ) : (
            <button type="button" onClick={() => void cancel()} disabled={cancelling} className="text-sm text-smoke underline underline-offset-4 hover:text-bone disabled:opacity-50">
              {cancelling ? 'Cancelling…' : 'Cancel renewal'}
            </button>
          )}
          {cancelError && <p className="mt-1 text-sm text-crimson">{cancelError}</p>}
        </div>
      )}
      {license && (
        <div className="mt-4 rounded-xl border border-ember/30 bg-black/30 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-smoke">Desktop licence key</p>
          <p className="mt-1 break-all font-mono text-lg font-bold tracking-widest text-bone">{license.key}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="btn-secondary px-3 py-2 normal-case tracking-normal">
              {copied ? <Check aria-hidden className="size-4 text-ember" /> : <Copy aria-hidden className="size-4" />}
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <a href={INSTALLER_URL} className="btn-primary px-3 py-2 normal-case tracking-normal">
              <Download aria-hidden className="size-4" />
              Download for Windows
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}

function CaregiversCard({ token }: { token: string }) {
  const { account } = useSession();
  const [access, setAccess] = useState<CaregiverAccessList | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canShare = account?.entitlements.features.includes('caregiver_link') ?? false;

  const load = useCallback(() => {
    api.caregivers
      .list(token)
      .then(setAccess)
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  }, [token]);

  useEffect(() => load(), [load]);

  const act = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      load();
    } catch (failure) {
      setError(failure instanceof ApiError || failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const candidate = username.trim().replace(/^@/, '').toLowerCase();
    if (!candidate) return;
    void act('add', async () => {
      await api.caregivers.add(candidate, token);
      setUsername('');
    });
  };

  const caregivers = access?.caregivers ?? [];
  const requests = caregivers.filter((row) => row.status === 'pending');
  const approved = caregivers.filter((row) => row.status === 'approved');
  const denied = caregivers.filter((row) => row.status === 'denied');
  const speakers = access?.speakers ?? [];

  return (
    <Card title="Caregivers" icon={ShieldCheck}>
      <p className="text-sm text-smoke">
        Nobody can watch you without your approval. A caregiver signs in, enters your room code, and appears here to approve; or add their username yourself.
      </p>

      {requests.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-ember">Asking to watch you</p>
          <ul className="mt-2 space-y-2">
            {requests.map((row) => (
              <PersonRow key={row.id} row={row}>
                <button type="button" disabled={busy !== null || !canShare} onClick={() => void act(row.id, () => api.caregivers.decide(row.id, true, token))} className="btn-primary px-3 py-1.5 text-xs">
                  <Check aria-hidden className="size-3.5" />
                  Approve
                </button>
                <button type="button" disabled={busy !== null} onClick={() => void act(row.id, () => api.caregivers.decide(row.id, false, token))} className="btn-secondary px-3 py-1.5 text-xs">
                  <X aria-hidden className="size-3.5" />
                  Deny
                </button>
              </PersonRow>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wider text-smoke">Can watch you</p>
        {approved.length === 0 ? (
          <p className="mt-2 text-sm text-smoke">No one yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {approved.map((row) => (
              <PersonRow key={row.id} row={row}>
                <button type="button" disabled={busy !== null} onClick={() => void act(row.id, () => api.caregivers.remove(row.id, token))} className="btn-secondary px-3 py-1.5 text-xs">
                  Remove
                </button>
              </PersonRow>
            ))}
          </ul>
        )}
        {denied.length > 0 && <p className="mt-2 text-xs text-smoke">Denied: {denied.map((row) => `@${row.username}`).join(', ')}. Add a username below to approve it after all.</p>}
      </div>

      {canShare ? (
        <form onSubmit={add} className="mt-4 flex gap-2">
          <label htmlFor="add-caregiver" className="sr-only">
            Caregiver username
          </label>
          <div className="relative flex-1">
            <AtSign aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-smoke" />
            <input id="add-caregiver" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="their username" maxLength={21} className="field pl-9" />
          </div>
          <button type="submit" disabled={busy !== null || !username.trim()} className="btn-primary px-4">
            {busy === 'add' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <UserPlus aria-hidden className="size-4" />}
            Approve
          </button>
        </form>
      ) : (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-smoke">
          Sharing with caregivers comes with Pro and Lifetime.{' '}
          <Link href="/#pricing" className="text-ember hover:underline">
            See plans
          </Link>
        </p>
      )}

      {speakers.length > 0 && (
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-smoke">
            <Eye aria-hidden className="size-3.5" />
            People you watch
          </p>
          <ul className="mt-2 space-y-2">
            {speakers.map((row) => (
              <PersonRow key={row.id} row={row} status>
                <button type="button" disabled={busy !== null} onClick={() => void act(row.id, () => api.caregivers.remove(row.id, token))} className="btn-secondary px-3 py-1.5 text-xs">
                  {row.status === 'approved' ? 'Stop watching' : 'Withdraw'}
                </button>
              </PersonRow>
            ))}
          </ul>
          <Link href="/caregiver" className="mt-3 inline-flex items-center gap-1.5 text-sm text-ember hover:underline">
            Open the caregiver console
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-crimson">
          {error}
        </p>
      )}
    </Card>
  );
}

const STATUS_WORD = { pending: 'waiting for approval', approved: 'approved', denied: 'not approved' } as const;

function PersonRow({ row, children, status = false }: { row: CaregiverAllowance; children: ReactNode; status?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-2.5">
      <Avatar name={row.displayName || row.username} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-bone">{row.displayName || `@${row.username}`}</span>
        <span className="block truncate text-xs text-smoke">
          @{row.username}
          {status && ` · ${STATUS_WORD[row.status]}`}
        </span>
      </span>
      <span className="flex gap-2">{children}</span>
    </li>
  );
}

function AnswersCard() {
  const { account } = useSession();
  const { openInterview } = useAuthFlow();
  const answers = account?.profile?.onboarding ?? null;
  const picks = useMemo(() => (answers ? recommend(answers) : []), [answers]);

  return (
    <Card
      title="Your answers"
      icon={Sparkles}
      action={
        <button type="button" onClick={openInterview} className="btn-secondary px-3 py-2 normal-case tracking-normal">
          <Pencil aria-hidden className="size-4" />
          {answers ? 'Change' : 'Answer'}
        </button>
      }
    >
      {answers ? (
        <>
          <dl>
            <Row label="Setting it up for" value={labelOf(ROLE_CHOICES, answers.role)} />
            <Row label="Goals" value={answers.goals.map((goal) => labelOf(GOAL_CHOICES, goal)).join(', ') || '—'} />
            <Row label="Speech" value={answers.speech.map((item) => labelOf(SPEECH_CHOICES, item)).join(', ') || '—'} />
            <Row label="Where" value={answers.places.map((place) => labelOf(PLACE_CHOICES, place)).join(', ') || '—'} />
            <Row label="Experience" value={labelOf(EXPERIENCE_CHOICES, answers.experience) || '—'} />
          </dl>
          <p className="mt-4 text-xs font-bold uppercase tracking-wider text-smoke">Suggested for you</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {picks.map((pick) => (
              <li key={pick.mode} title={pick.why} className="badge normal-case tracking-normal text-bone">
                {pick.mode}
                {pick.pro && <span className="text-ember">Pro</span>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-smoke">A few quick questions help us suggest where to start. They stay in your account and you can change them any time.</p>
      )}
    </Card>
  );
}

function AccountCard() {
  const session = useSession();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!session.token) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.deleteAccount(password, session.token);
      session.signOut();
      router.push('/');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Account" icon={UserRound}>
      <p className="text-sm text-smoke">Signing out here does not sign out the desktop app. Deleting the account erases it and everything saved with it, for good.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            session.signOut();
            router.push('/');
          }}
          className="btn-secondary"
        >
          <LogOut aria-hidden className="size-4" />
          Sign out
        </button>
        <button type="button" onClick={() => setDeleting(true)} className="btn-secondary border-crimson/40 text-crimson hover:border-crimson">
          <Trash2 aria-hidden className="size-4" />
          Delete account
        </button>
      </div>
      <Modal open={deleting} onClose={() => setDeleting(false)} title="Delete your account?" locked={busy}>
        <form onSubmit={remove} className="space-y-4">
          <p className="text-sm text-smoke">
            This erases your account, licence, subscriptions, remembered computers, caregiver approvals and everything saved in the app. It cannot be undone.
          </p>
          <div>
            <label htmlFor="delete-password" className="label">
              Your password
            </label>
            <input id="delete-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="field" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-crimson">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !password} className="btn-primary w-full justify-center bg-none bg-crimson">
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Trash2 aria-hidden className="size-4" />}
            Delete everything
          </button>
        </form>
      </Modal>
    </Card>
  );
}
