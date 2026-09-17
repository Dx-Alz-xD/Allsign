'use client';

/**
 * The caregiver's side of the link, in the browser: sign in, enter the room code the speaker shows in the desktop
 * app, and once the speaker approves your username, watch their voice, alerts and sentences live. A room code alone
 * shows nothing. No install; the data channel is peer to peer, the server only introduces the two devices.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { animate } from 'animejs';
import {
  Activity,
  Bell,
  BellOff,
  CircleCheck,
  Clock,
  Copy,
  Link2,
  Link2Off,
  LogIn,
  MessageSquareText,
  Radio,
  ShieldCheck,
  Siren,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { CaregiverAccessList, CaregiverAlert, CaregiverMessage, CaregiverTranscript } from '@shared/types';
import { Avatar } from '@/components/site/BrandMark';
import { useAuthFlow } from '@/components/site/SiteProviders';
import { CaregiverLink, generateClientId, type CaregiverLinkState, type LinkStatus } from '@/lib/peer/caregiverLink';
import { api, backendWebSocketUrl, iceServers } from '@/lib/api';
import { reducedMotion } from '@/lib/motion';
import { useSession } from '@/lib/session';

const ROOM_PATTERN = /^[A-Z0-9-]{4,64}$/;
const MAX_ALERTS = 50;
const MAX_TRANSCRIPTS = 100;
const STALE_AFTER_MS = 4000;
const CLIENT_ID_KEY = 'voicematics.caregiver-client-id';

/** One id per browser tab, kept across reconnects, so the relay hands this tab its old seat instead of refusing it. */
function clientId(): string {
  try {
    const stored = window.sessionStorage.getItem(CLIENT_ID_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const created = generateClientId();
    window.sessionStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return generateClientId();
  }
}

const STATUS_TEXT: Record<LinkStatus, string> = {
  idle: 'Not connected',
  signalling: 'Reaching the server',
  waiting: 'Waiting for the speaker to join this room',
  connecting: 'Connecting to the speaker',
  connected: 'Connected to the speaker',
  error: 'Connection problem',
  closed: 'Disconnected',
};

const ALERT_LABEL: Record<CaregiverAlert['kind'], string> = {
  'vocal-block': 'Vocal block',
  fatigue: 'Vocal strain',
  emergency: 'Emergency',
  trigger: 'Trigger',
  message: 'Message',
};

interface Live {
  at: number;
  volumeDb: number;
  pitchHz: number;
  wpm: number;
  blocked: boolean;
  blockMs: number;
  strain: number;
  jitter: number;
  hnr: number;
  latencyMs: number;
}

function strainWord(strain: number): string {
  if (strain >= 75) return 'high, rest soon';
  if (strain >= 55) return 'rising';
  if (strain >= 30) return 'moderate';
  return 'relaxed';
}

/** Two short tones through Web Audio, so an alert is heard without any audio file. */
function chime(emergency: boolean) {
  try {
    const context = new AudioContext();
    const now = context.currentTime;
    const notes = emergency ? [880, 1174, 880, 1174] : [660, 880];
    notes.forEach((hz, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, now + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, now + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + index * 0.18);
      oscillator.stop(now + index * 0.18 + 0.17);
    });
    window.setTimeout(() => void context.close(), 1200);
  } catch {
    // No audio output: the alert is still on screen.
  }
}

/** Signed out, the console explains the approval model and asks for an account; nothing else is reachable. */
export function CaregiverConsole({ initialRoom }: { initialRoom: string }) {
  const session = useSession();
  const { openSignIn, openSignUp } = useAuthFlow();
  if (!session.ready) {
    return (
      <p className="panel p-6 text-smoke" aria-live="polite">
        {session.waking ? 'Waking the Voicematics server. This can take up to a minute.' : 'Checking your account…'}
      </p>
    );
  }
  if (!session.account || !session.token) {
    return (
      <section aria-labelledby="gate-heading" className="panel overflow-hidden">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <p className="badge">
              <ShieldCheck aria-hidden className="size-3.5 text-ember" />
              Approved caregivers only
            </p>
            <h2 id="gate-heading" className="mt-4 font-display text-2xl font-bold text-bone sm:text-3xl">
              Sign in to watch someone you care for
            </h2>
            <p className="mt-3 max-w-prose text-smoke">
              A room code on its own shows nothing. You sign in, the speaker approves your username in their desktop app, and only then do their readings, alerts
              and sentences reach you.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={openSignIn} className="btn-primary">
                <LogIn aria-hidden className="size-4" />
                Sign in
              </button>
              <button type="button" onClick={openSignUp} className="btn-secondary">
                <Sparkles aria-hidden className="size-4 text-ember" />
                Create a free account
              </button>
            </div>
            {initialRoom && <p className="mt-4 text-sm text-smoke">You opened a link to room {initialRoom}. After signing in you will be connected to it.</p>}
          </div>
          <ol className="space-y-4">
            {[
              { title: 'Sign in or create a free account', text: 'Caregivers do not need a paid plan. Your username is how the speaker recognises you.' },
              { title: 'Enter the speaker’s room code', text: 'They see it in the desktop app under Caregiver Link, or send you a link that fills it in.' },
              { title: 'The speaker approves you', text: 'They get a request with your username and approve it once. They can remove you at any time.' },
            ].map((item, index) => (
              <li key={item.title} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ember/15 font-display text-sm font-bold text-ember ring-1 ring-ember/40">{index + 1}</span>
                <span>
                  <span className="block font-semibold text-bone">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-smoke">{item.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }
  return <Console initialRoom={initialRoom} />;
}

function approvalLine(link: CaregiverLinkState | null): { tone: 'wait' | 'ok'; text: string } | null {
  switch (link?.approval) {
    case 'waiting-for-speaker':
      return { tone: 'wait', text: 'Waiting for the speaker to open Caregiver Link with this room code.' };
    case 'pending':
      return { tone: 'wait', text: 'The speaker has been asked to approve your username. You connect the moment they do.' };
    case 'approved':
      return { tone: 'ok', text: link.watching ? `Approved: you are watching ${link.watching.displayName || `@${link.watching.username}`}.` : 'Approved by the speaker.' };
    default:
      return null;
  }
}

function Console({ initialRoom }: { initialRoom: string }) {
  const session = useSession();
  const tokenRef = useRef(session.token);
  tokenRef.current = session.token;
  const username = session.account?.profile?.username ?? '';
  const [access, setAccess] = useState<CaregiverAccessList | null>(null);
  const [usernameCopied, setUsernameCopied] = useState(false);
  const [room, setRoom] = useState(initialRoom);
  const [link, setLink] = useState<CaregiverLinkState | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [alerts, setAlerts] = useState<CaregiverAlert[]>([]);
  const [transcripts, setTranscripts] = useState<CaregiverTranscript[]>([]);
  const [sound, setSound] = useState(true);
  const [notify, setNotify] = useState<NotificationPermission | 'unsupported'>('default');
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<CaregiverLink | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const alertsRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setNotify(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const onMessage = useCallback((message: CaregiverMessage) => {
    if (message.type === 'telemetry') {
      const { telemetry, fluency, latencyMs } = message;
      setLive({
        at: Date.now(),
        volumeDb: telemetry.volumeDb,
        pitchHz: telemetry.pitchHz,
        wpm: fluency.wpm,
        blocked: fluency.vocalBlockDetected,
        blockMs: fluency.blockDurationMs,
        strain: telemetry.vocalStrainIndex,
        jitter: telemetry.jitterPercent,
        hnr: telemetry.hnrDb,
        latencyMs,
      });
      return;
    }
    if (message.type === 'alert') {
      const { alert } = message;
      setAlerts((current) => [alert, ...current.filter((item) => item.id !== alert.id)].slice(0, MAX_ALERTS));
      if (soundRef.current) chime(alert.kind === 'emergency');
      if (notifyRef.current === 'granted' && document.visibilityState !== 'visible') {
        new Notification(`Voicematics: ${ALERT_LABEL[alert.kind]}${alert.origin === 'phone' ? ' from their phone' : ''}`, { body: alert.message, tag: alert.id });
      }
      return;
    }
    setTranscripts((current) => [message.transcript, ...current.filter((item) => item.id !== message.transcript.id)].slice(0, MAX_TRANSCRIPTS));
  }, []);

  const connect = useCallback(
    (code: string) => {
      linkRef.current?.close();
      const next = new CaregiverLink({
        role: 'caregiver',
        room: code,
        clientId: clientId(),
        getAuthToken: () => tokenRef.current,
        signalUrl: backendWebSocketUrl(),
        iceServers: iceServers(),
        onMessage,
        onState: setLink,
      });
      linkRef.current = next;
      next.connect();
    },
    [onMessage],
  );

  const disconnect = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    setLink((current) => (current ? { ...current, status: 'closed', peerPresent: false } : current));
    setLive(null);
  }, []);

  useEffect(() => () => linkRef.current?.close(), []);

  // The speakers who approved this account (or were asked to), refreshed whenever the approval changes.
  useEffect(() => {
    if (!session.token) return;
    api.caregivers
      .list(session.token)
      .then(setAccess)
      .catch(() => undefined);
  }, [session.token, link?.approval]);

  // A link in the URL connects straight away, so the speaker can just send it.
  useEffect(() => {
    if (initialRoom && ROOM_PATTERN.test(initialRoom)) connect(initialRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoom]);

  // New alerts rise in; an emergency one also pulls the page to it.
  useEffect(() => {
    const first = alertsRef.current?.firstElementChild;
    if (!first || reducedMotion()) return;
    animate(first, { opacity: [0, 1], x: [24, 0], duration: 420, ease: 'outCubic' });
    if (alerts[0]?.kind === 'emergency') first.scrollIntoView({ block: 'nearest' });
  }, [alerts]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = room.trim().toUpperCase();
    if (!ROOM_PATTERN.test(code)) return;
    setRoom(code);
    connect(code);
  };

  const askToNotify = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotify(result);
  };

  const shareLink = useMemo(() => (typeof window === 'undefined' ? '' : `${window.location.origin}/caregiver?room=${encodeURIComponent(room.trim().toUpperCase())}`), [room]);

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(username);
      setUsernameCopied(true);
      window.setTimeout(() => setUsernameCopied(false), 2000);
    } catch {
      setUsernameCopied(false);
    }
  };

  const approval = approvalLine(link);
  const approvedBy = access?.speakers.filter((row) => row.status === 'approved') ?? [];
  const asked = access?.speakers.filter((row) => row.status === 'pending') ?? [];
  const active = link !== null && link.status !== 'closed' && link.status !== 'idle' && link.status !== 'error';
  const connected = link?.status === 'connected';
  const stale = live !== null && now - live.at > STALE_AFTER_MS;
  const volumePercent = live ? Math.max(0, Math.min(100, ((live.volumeDb + 60) / 60) * 100)) : 0;
  const emergency = alerts.find((alert) => alert.kind === 'emergency' && now - alert.timestamp < 5 * 60 * 1000);

  return (
    <div className="space-y-6">
      {emergency && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-crimson bg-crimson/15 p-5 shadow-[0_0_40px_-10px_#FF3333] motion-safe:animate-pulse">
          <Siren aria-hidden className="mt-0.5 size-7 shrink-0 text-crimson" />
          <div className="min-w-0">
            <p className="font-display text-xl font-bold text-bone">Emergency alert from the speaker{emergency.origin === 'phone' ? '’s phone' : ''}</p>
            <p className="mt-1 text-bone">{emergency.message}</p>
            <p className="mt-1 text-sm text-smoke">{new Date(emergency.timestamp).toLocaleTimeString()}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="pair-heading" className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="pair-heading" className="font-display text-xl font-semibold text-bone">
              Join the speaker&apos;s room
            </h2>
            <p className="mt-1 max-w-prose text-smoke">
              In the desktop app the speaker opens <span className="text-bone">Caregiver Link</span> and shares the room code. Enter it here; they approve your username
              once, and you connect.
            </p>
          </div>
          {username && (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 py-2 pl-2 pr-3">
              <Avatar name={session.account?.profile?.displayName || username} />
              <div className="min-w-0">
                <p className="text-xs text-smoke">The speaker approves</p>
                <p className="font-display font-semibold text-bone">@{username}</p>
              </div>
              <button type="button" onClick={() => void copyUsername()} aria-label="Copy your username" className="rounded-lg p-2 text-smoke hover:bg-white/10 hover:text-bone">
                {usernameCopied ? <CircleCheck aria-hidden className="size-4 text-ember" /> : <Copy aria-hidden className="size-4" />}
              </button>
            </div>
          )}
        </div>
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="room" className="label">
              Room code
            </label>
            <input id="room" value={room} onChange={(event) => setRoom(event.target.value.toUpperCase())} disabled={active} placeholder="ABCD-1234" className="field w-48 font-display text-lg tracking-widest" autoComplete="off" />
          </div>
          {active ? (
            <button type="button" onClick={disconnect} className="btn-secondary">
              <Link2Off aria-hidden className="size-4" />
              Leave
            </button>
          ) : (
            <button type="submit" disabled={!ROOM_PATTERN.test(room.trim().toUpperCase())} className="btn-primary">
              <Link2 aria-hidden className="size-4" />
              Connect
            </button>
          )}
          {ROOM_PATTERN.test(room.trim().toUpperCase()) && (
            <button type="button" onClick={() => void copyShareLink()} className="btn-secondary">
              <Copy aria-hidden className="size-4" />
              {copied ? 'Link copied' : 'Copy link to this room'}
            </button>
          )}
        </form>
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-smoke" aria-live="polite">
          <Radio aria-hidden className={`size-4 ${connected ? 'text-ember' : ''}`} />
          {link ? (link.status === 'waiting' && link.peerPresent ? 'The speaker is here, connecting' : STATUS_TEXT[link.status]) : STATUS_TEXT.idle}
          {link?.roundTripMs !== null && link?.roundTripMs !== undefined && <span>· {link.roundTripMs} ms round trip</span>}
          {link?.error && <span className="text-crimson">· {link.error}</span>}
        </p>
        {approval && (
          <p className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${approval.tone === 'ok' ? 'border-ember/40 bg-ember/10 text-bone' : 'border-white/10 bg-black/30 text-smoke'}`} aria-live="polite">
            {approval.tone === 'ok' ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ember" /> : <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />}
            {approval.text}
          </p>
        )}
        {(approvedBy.length > 0 || asked.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-smoke">
            <ShieldCheck aria-hidden className="size-4 text-ember" />
            {approvedBy.length > 0 && <span>Approved by {approvedBy.map((row) => row.displayName || `@${row.username}`).join(', ')}.</span>}
            {asked.length > 0 && <span>Waiting on {asked.map((row) => row.displayName || `@${row.username}`).join(', ')}.</span>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setSound((value) => !value)} aria-pressed={sound} className="btn-secondary px-4 py-2">
            {sound ? <Volume2 aria-hidden className="size-4" /> : <VolumeX aria-hidden className="size-4" />}
            {sound ? 'Alert sound on' : 'Alert sound off'}
          </button>
          {notify === 'granted' ? (
            <span className="badge">
              <Bell aria-hidden className="size-3.5 text-ember" />
              Notifications on
            </span>
          ) : notify === 'default' ? (
            <button type="button" onClick={() => void askToNotify()} className="btn-secondary px-4 py-2">
              <Bell aria-hidden className="size-4" />
              Notify me when this tab is hidden
            </button>
          ) : notify === 'denied' ? (
            <span className="badge">
              <BellOff aria-hidden className="size-3.5" />
              Notifications blocked in the browser
            </span>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section aria-labelledby="live-heading" className="panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="live-heading" className="font-display text-xl font-semibold text-bone">
              Right now
            </h2>
            <span className="text-sm text-smoke">{live ? (stale ? 'No readings for a few seconds' : `updated ${Math.max(0, Math.round((now - live.at) / 1000))} s ago`) : connected ? 'Waiting for readings' : 'Not connected'}</span>
          </div>

          <div className={`mt-5 grid gap-4 sm:grid-cols-2 ${stale || !live ? 'opacity-50' : ''}`}>
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 sm:col-span-2">
              <div className="flex items-center justify-between text-sm text-smoke">
                <span>Volume</span>
                <span className="tabular-nums text-bone">{live ? `${live.volumeDb.toFixed(0)} dBFS` : '—'}</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-ember-edge transition-[width] duration-150" style={{ width: `${volumePercent}%` }} />
              </div>
            </div>
            <Reading label="Speaking rate" value={live ? `${Math.round(live.wpm)}` : '—'} unit="words / min" />
            <Reading label="Pitch" value={live && live.pitchHz > 0 ? `${Math.round(live.pitchHz)}` : '—'} unit="Hz" />
            <div className={`rounded-xl border p-4 ${live?.blocked ? 'border-crimson/70 bg-crimson/10' : 'border-white/10 bg-black/30'}`}>
              <p className="text-sm text-smoke">Vocal block</p>
              <p className="mt-1 font-display text-3xl font-bold text-bone">{live?.blocked ? `${(live.blockMs / 1000).toFixed(1)} s` : 'None'}</p>
              <p className="text-xs text-smoke">{live?.blocked ? 'a block is happening now' : 'speech is flowing'}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-smoke">Vocal strain</p>
              <p className="mt-1 font-display text-3xl font-bold tabular-nums text-bone">{live ? Math.round(live.strain) : '—'}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full transition-[width] duration-300 ${live && live.strain >= 75 ? 'bg-crimson' : live && live.strain >= 55 ? 'bg-ember' : 'bg-bone/60'}`} style={{ width: `${live ? live.strain : 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-smoke">{live ? strainWord(live.strain) : 'out of 100'}</p>
            </div>
            <Reading label="Pitch stability" value={live ? `${live.jitter.toFixed(2)}` : '—'} unit="% jitter" />
            <Reading label="Clarity" value={live ? `${live.hnr.toFixed(1)}` : '—'} unit="dB harmonics to noise" />
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-smoke">
            <Activity aria-hidden className="size-3.5" />
            Readings come straight from the speaker&apos;s computer, {live ? `${live.latencyMs.toFixed(1)} ms` : 'a few ms'} after each frame of audio. No audio is sent.
          </p>
        </section>

        <div className="space-y-6">
          <section aria-labelledby="alerts-heading" className="panel p-5 sm:p-6">
            <h2 id="alerts-heading" className="flex items-center gap-2 font-display text-xl font-semibold text-bone">
              <TriangleAlert aria-hidden className="size-5 text-ember" />
              Alerts
            </h2>
            {alerts.length === 0 ? (
              <p className="mt-2 text-sm text-smoke">Vocal blocks, strain warnings, emergencies, trigger alerts and messages from the speaker&apos;s phone appear here the moment they happen.</p>
            ) : (
              <ul ref={alertsRef} className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" aria-live="assertive">
                {alerts.map((alert) => (
                  <li key={alert.id} className={`rounded-xl border px-3 py-2 ${alert.kind === 'emergency' ? 'border-crimson/70 bg-crimson/10' : 'border-white/10 bg-black/30'}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex items-center gap-2 font-semibold text-bone">
                        {ALERT_LABEL[alert.kind]}
                        {alert.origin === 'phone' && (
                          <span className="badge px-2 py-0.5 normal-case tracking-normal">
                            <Smartphone aria-hidden className="size-3" />
                            phone
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-smoke">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-sm text-smoke">
                      {alert.message}
                      {alert.durationMs !== undefined && ` (${(alert.durationMs / 1000).toFixed(1)} s)`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sentences-heading" className="panel p-5 sm:p-6">
            <h2 id="sentences-heading" className="flex items-center gap-2 font-display text-xl font-semibold text-bone">
              <MessageSquareText aria-hidden className="size-5 text-ember" />
              What they said
            </h2>
            {transcripts.length === 0 ? (
              <p className="mt-2 text-sm text-smoke">Each sentence the app rebuilds shows up here as soon as it is ready.</p>
            ) : (
              <ul className="mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
                {transcripts.map((transcript) => (
                  <li key={transcript.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                    <p className="font-display text-lg text-bone">{transcript.grammar.formattedText}</p>
                    <p className="mt-0.5 text-xs text-smoke">
                      {new Date(transcript.timestamp).toLocaleTimeString()} · {transcript.source === 'demo' ? 'demo script' : transcript.source === 'system-dictation' ? 'dictated' : transcript.source === 'on-device' ? 'spoken' : 'typed'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Reading({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <p className="text-sm text-smoke">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums text-bone">{value}</p>
      <p className="text-xs text-smoke">{unit}</p>
    </div>
  );
}
