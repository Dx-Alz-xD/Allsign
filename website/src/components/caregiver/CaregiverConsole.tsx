'use client';

/**
 * The caregiver's side of the link, in the browser: enter the room code the speaker shows in the desktop
 * app and watch their voice, alerts and rebuilt sentences live. No install, no account; the data channel is
 * peer to peer, the server only introduces the two devices.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { animate } from 'animejs';
import { Activity, Bell, BellOff, Copy, Link2, Link2Off, MessageSquareText, Radio, Siren, TriangleAlert, Volume2, VolumeX } from 'lucide-react';
import type { CaregiverAlert, CaregiverMessage, CaregiverTranscript } from '@shared/types';
import { CaregiverLink, generateClientId, type CaregiverLinkState, type LinkStatus } from '@/lib/peer/caregiverLink';
import { backendWebSocketUrl, iceServers } from '@/lib/api';
import { reducedMotion } from '@/lib/motion';

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

export function CaregiverConsole({ initialRoom }: { initialRoom: string }) {
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
        new Notification(`Voicematics: ${ALERT_LABEL[alert.kind]}`, { body: alert.message, tag: alert.id });
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

  const active = link !== null && link.status !== 'closed' && link.status !== 'idle';
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
            <p className="font-display text-xl font-bold text-bone">Emergency alert from the speaker</p>
            <p className="mt-1 text-bone">{emergency.message}</p>
            <p className="mt-1 text-sm text-smoke">{new Date(emergency.timestamp).toLocaleTimeString()}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="pair-heading" className="panel p-5 sm:p-6">
        <h2 id="pair-heading" className="font-display text-xl font-semibold text-bone">
          Join the speaker&apos;s room
        </h2>
        <p className="mt-1 max-w-prose text-smoke">
          In the desktop app the speaker opens <span className="text-bone">Caregiver Link</span>, chooses <span className="text-bone">speaker</span> and shares the room code. Enter it here.
        </p>
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
              <p className="mt-2 text-sm text-smoke">Vocal blocks, strain warnings, emergencies and trigger alerts appear here the moment they happen.</p>
            ) : (
              <ul ref={alertsRef} className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" aria-live="assertive">
                {alerts.map((alert) => (
                  <li key={alert.id} className={`rounded-xl border px-3 py-2 ${alert.kind === 'emergency' ? 'border-crimson/70 bg-crimson/10' : 'border-white/10 bg-black/30'}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-bone">{ALERT_LABEL[alert.kind]}</span>
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
                      {new Date(transcript.timestamp).toLocaleTimeString()} · {transcript.source === 'demo' ? 'demo script' : transcript.source === 'system-dictation' ? 'dictated' : 'typed'}
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
