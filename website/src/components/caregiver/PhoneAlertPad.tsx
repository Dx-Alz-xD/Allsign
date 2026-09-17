'use client';

/**
 * The speaker's phone as an alert button. Sign in with the same Voicematics account as the desktop app, enter the
 * room code the app shows, and one tap reaches the caregiver's dashboard, even when the desktop app is closed.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Clock, LogIn, LogOut, MessageSquare, Radio, Send, Siren, TriangleAlert } from 'lucide-react';
import type { PhoneAlertRequest } from '@shared/types';
import { AuthModal } from '@/components/AuthModal';
import { backendWebSocketUrl } from '@/lib/api';
import { PhoneAlertLink, type PhoneAlertOutcome, type PhoneLinkState } from '@/lib/peer/phoneAlert';
import { generateClientId } from '@/lib/peer/caregiverLink';
import { SessionProvider, useSession } from '@/lib/session';

const ROOM_PATTERN = /^[A-Z0-9-]{4,64}$/;
const ROOM_KEY = 'voicematics.alert-room';
const CLIENT_KEY = 'voicematics.alert-client-id';
const MAX_MESSAGE_CHARS = 200;
const MAX_LOG = 20;

const QUICK_MESSAGES = ['Please come here', 'I need help', 'I am okay', 'Please call me', 'I need a break'];

interface SentAlert {
  localId: string;
  kind: PhoneAlertRequest['kind'];
  message: string;
  at: number;
  outcome: PhoneAlertOutcome | { status: 'sending' };
}

function stored(key: string, storage: () => Storage): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string, storage: () => Storage): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Blocked storage: it lasts for this page only.
  }
}

function deviceId(): string {
  const existing = stored(CLIENT_KEY, () => window.localStorage);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const created = generateClientId();
  store(CLIENT_KEY, created, () => window.localStorage);
  return created;
}

const OUTCOME_TEXT: Record<SentAlert['outcome']['status'], string> = {
  sending: 'Sending',
  sent: 'Sent to the caregiver',
  delivered: 'Delivered: it is on the caregiver’s dashboard',
  held: 'No caregiver connected yet: it will reach them when they open the console (within 10 minutes)',
  failed: 'Not sent',
};

function Pad({ initialRoom }: { initialRoom: string }) {
  const session = useSession();
  const [authOpen, setAuthOpen] = useState(false);
  const [room, setRoom] = useState(initialRoom);
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [state, setState] = useState<PhoneLinkState>({ status: 'idle', caregiverPresent: false, error: null });
  const [log, setLog] = useState<SentAlert[]>([]);
  const [custom, setCustom] = useState('');
  const linkRef = useRef<PhoneAlertLink | null>(null);

  const canAlert = session.account?.entitlements.features.includes('caregiver_link') ?? false;

  useEffect(() => {
    if (initialRoom) return;
    const remembered = stored(ROOM_KEY, () => window.localStorage);
    if (remembered && ROOM_PATTERN.test(remembered)) setRoom(remembered);
  }, [initialRoom]);

  const onOutcome = useCallback((localId: string, outcome: PhoneAlertOutcome) => {
    // A late "sent" never downgrades a confirmed delivery.
    setLog((current) => current.map((item) => (item.localId === localId && item.outcome.status !== 'delivered' ? { ...item, outcome } : item)));
  }, []);

  const join = useCallback(
    (code: string) => {
      if (!session.token) return;
      linkRef.current?.close();
      const link = new PhoneAlertLink({ room: code, signalUrl: backendWebSocketUrl(), token: session.token, clientId: deviceId(), onState: setState, onOutcome });
      linkRef.current = link;
      setJoinedRoom(code);
      store(ROOM_KEY, code, () => window.localStorage);
      link.connect();
    },
    [onOutcome, session.token],
  );

  const leave = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    setJoinedRoom(null);
    setState({ status: 'idle', caregiverPresent: false, error: null });
  }, []);

  useEffect(() => () => linkRef.current?.close(), []);

  // A link with a room code joins as soon as the account is known.
  useEffect(() => {
    if (session.token && canAlert && joinedRoom === null && ROOM_PATTERN.test(initialRoom)) join(initialRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, canAlert]);

  // Signing out ends the connection.
  useEffect(() => {
    if (!session.token && linkRef.current) leave();
  }, [leave, session.token]);

  const send = (kind: PhoneAlertRequest['kind'], message: string) => {
    const link = linkRef.current;
    const text = message.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!link || !text) return;
    const localId = link.send(kind, text);
    setLog((current) => [{ localId, kind, message: text, at: Date.now(), outcome: { status: 'sending' as const } }, ...current].slice(0, MAX_LOG));
    try {
      navigator.vibrate?.(kind === 'emergency' ? [120, 60, 120] : 60);
    } catch {
      // No vibration on this device.
    }
  };

  const submitRoom = (event: FormEvent) => {
    event.preventDefault();
    const code = room.trim().toUpperCase();
    if (ROOM_PATTERN.test(code)) join(code);
  };

  const submitCustom = (event: FormEvent) => {
    event.preventDefault();
    if (!custom.trim()) return;
    send('message', custom);
    setCustom('');
  };

  if (!session.ready) {
    return (
      <p className="panel p-5 text-smoke" aria-live="polite">
        {session.waking ? 'Waking the Voicematics server. This can take up to a minute.' : 'Checking your account…'}
      </p>
    );
  }

  if (!session.account) {
    return (
      <section className="panel space-y-4 p-5">
        <p className="text-bone">Sign in with the same Voicematics account you use in the desktop app. Only that account can send alerts into its room.</p>
        <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary w-full justify-center">
          <LogIn aria-hidden className="size-4" />
          Sign in
        </button>
        <AuthModal mode={authOpen ? 'signin' : null} onClose={() => setAuthOpen(false)} onDone={() => setAuthOpen(false)} />
      </section>
    );
  }

  if (!canAlert) {
    return (
      <section className="panel space-y-3 p-5">
        <p className="text-bone">The alert button is part of the Caregiver Link, which comes with Voicematics Pro and Lifetime.</p>
        <p className="text-sm text-smoke">Signed in as {session.account.user.email}.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/#pricing" className="btn-primary">
            See plans
          </a>
          <button type="button" onClick={session.signOut} className="btn-secondary">
            <LogOut aria-hidden className="size-4" />
            Sign out
          </button>
        </div>
      </section>
    );
  }

  const ready = state.status === 'ready';
  const connectedText =
    state.status === 'ready'
      ? state.caregiverPresent
        ? 'Connected. Your caregiver is watching.'
        : 'Connected. No caregiver has the console open; alerts wait for them for 10 minutes.'
      : state.status === 'connecting'
        ? 'Connecting…'
        : state.status === 'reconnecting'
          ? 'Reconnecting… Alerts you press now are sent as soon as it is back.'
          : state.status === 'stopped'
            ? 'Not connected.'
            : '';

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        {joinedRoom === null ? (
          <form onSubmit={submitRoom} className="space-y-3">
            <label htmlFor="alert-room" className="label">
              Room code from the desktop app
            </label>
            <input
              id="alert-room"
              value={room}
              onChange={(event) => setRoom(event.target.value.toUpperCase())}
              placeholder="ABCD-1234"
              autoComplete="off"
              className="field font-display text-2xl tracking-widest"
            />
            <button type="submit" disabled={!ROOM_PATTERN.test(room.trim().toUpperCase())} className="btn-primary w-full justify-center">
              <Radio aria-hidden className="size-4" />
              Use this room
            </button>
            <p className="text-sm text-smoke">In the desktop app open Caregiver Link, connect as the speaker, and use the room code shown there.</p>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-smoke">Room</p>
              <p className="font-display text-2xl font-bold tracking-widest text-bone">{joinedRoom}</p>
            </div>
            <button type="button" onClick={leave} className="btn-secondary px-4 py-2">
              Change room
            </button>
            <p className={`w-full text-sm ${state.status === 'stopped' ? 'text-crimson' : 'text-smoke'}`} aria-live="polite">
              <Radio aria-hidden className={`mr-1.5 inline size-4 ${ready && state.caregiverPresent ? 'text-ember' : ''}`} />
              {connectedText}
              {state.error && state.status !== 'ready' && <span className="block text-crimson">{state.error}</span>}
            </p>
          </div>
        )}
      </section>

      {joinedRoom !== null && state.status !== 'stopped' && (
        <>
          <button
            type="button"
            onClick={() => send('emergency', 'I need help now')}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-crimson bg-crimson/20 px-6 py-10 font-display text-3xl font-bold uppercase tracking-wider text-bone shadow-[0_0_40px_-10px_#FF3333] transition active:scale-[0.98] active:bg-crimson/40"
          >
            <Siren aria-hidden className="size-12 text-crimson" />
            Emergency
            <span className="font-sans text-sm font-normal normal-case tracking-normal text-smoke">Tap once to alert your caregiver</span>
          </button>

          <section className="panel space-y-3 p-5" aria-labelledby="quick-heading">
            <h2 id="quick-heading" className="flex items-center gap-2 font-display text-lg font-semibold text-bone">
              <MessageSquare aria-hidden className="size-5 text-ember" />
              Quick messages
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_MESSAGES.map((message) => (
                <button key={message} type="button" onClick={() => send('message', message)} className="btn-secondary justify-center px-3 py-4 text-center normal-case tracking-normal">
                  {message}
                </button>
              ))}
            </div>
            <form onSubmit={submitCustom} className="flex gap-2">
              <label htmlFor="alert-custom" className="sr-only">
                Your own message
              </label>
              <input id="alert-custom" value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={MAX_MESSAGE_CHARS} placeholder="Type a message" className="field" />
              <button type="submit" disabled={!custom.trim()} className="btn-primary px-4" aria-label="Send message">
                <Send aria-hidden className="size-4" />
              </button>
            </form>
          </section>
        </>
      )}

      {log.length > 0 && (
        <section className="panel p-5" aria-labelledby="sent-heading">
          <h2 id="sent-heading" className="font-display text-lg font-semibold text-bone">
            Sent from this phone
          </h2>
          <ul className="mt-3 flex flex-col gap-2" aria-live="polite">
            {log.map((item) => (
              <li key={item.localId} className={`rounded-xl border px-3 py-2 ${item.kind === 'emergency' ? 'border-crimson/60 bg-crimson/10' : 'border-white/10 bg-black/30'}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-bone">{item.message}</span>
                  <span className="shrink-0 text-xs tabular-nums text-smoke">{new Date(item.at).toLocaleTimeString()}</span>
                </div>
                <p className={`mt-0.5 flex items-start gap-1.5 text-sm ${item.outcome.status === 'failed' ? 'text-crimson' : item.outcome.status === 'delivered' ? 'text-ember' : 'text-smoke'}`}>
                  {item.outcome.status === 'delivered' && <Check aria-hidden className="mt-0.5 size-4 shrink-0" />}
                  {(item.outcome.status === 'held' || item.outcome.status === 'sending' || item.outcome.status === 'sent') && <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />}
                  {item.outcome.status === 'failed' && <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
                  {OUTCOME_TEXT[item.outcome.status]}
                  {item.outcome.status === 'failed' && `: ${item.outcome.message}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-sm text-smoke">
        Signed in as {session.account.user.email}.{' '}
        <button type="button" onClick={session.signOut} className="underline underline-offset-4 hover:text-bone">
          Sign out
        </button>
      </p>
    </div>
  );
}

export function PhoneAlertPad({ initialRoom }: { initialRoom: string }) {
  return (
    <SessionProvider>
      <Pad initialRoom={initialRoom} />
    </SessionProvider>
  );
}
