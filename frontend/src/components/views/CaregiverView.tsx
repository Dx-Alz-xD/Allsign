'use client';

import { useId, useState, type FormEvent } from 'react';
import { Copy, Link2, Link2Off, Radio, Siren, Smartphone, TriangleAlert } from 'lucide-react';
import type { CaregiverRole } from '@shared/types';
import { ProBadge, UpgradeActions } from '@/components/account/PlanGate';
import { buttonStyles } from '@/components/modals/Modal';
import { inputStyles } from '@/components/modals/settings/controls';
import { useAccount } from '@/components/providers/AccountProvider';
import { useSession } from '@/components/providers/SessionProvider';
import { PitchModeDashboard } from '@/components/PitchModeDashboard';
import { TelemetryBar } from '@/components/TelemetryBar';
import { generateRoomCode } from '@/lib/peer/caregiverLink';
import { websiteUrl } from '@/lib/account/plans';
import { cn } from '@/lib/cn';

const STATUS_TEXT = {
  idle: 'Not connected',
  signalling: 'Reaching the signalling server',
  waiting: 'Waiting for the other device',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Connection problem',
  closed: 'Disconnected',
} as const;

const ALERT_LABELS = { 'vocal-block': 'Vocal block', fatigue: 'Vocal strain', emergency: 'Emergency', trigger: 'Trigger', message: 'Message' } as const;
/** An emergency stays pinned to the top this long. */
const EMERGENCY_BANNER_MS = 5 * 60 * 1000;

const EMERGENCY_NOTES = {
  sent: 'Emergency alert sent.',
  queued: 'Emergency alert queued; it goes out as soon as the caregiver connects.',
  none: 'Connect to a room first: without a caregiver link the alert cannot be sent.',
} as const;

/** Pair two devices through a room code: the speaker shares telemetry, the caregiver watches. */
export function CaregiverView() {
  const {
    link,
    connectCaregiver,
    disconnectCaregiver,
    alerts,
    remoteTelemetry,
    remoteTranscripts,
    peer,
    telemetry,
    sendEmergency,
    backendOnline,
  } = useSession();
  const latestTranscript = remoteTranscripts[0] ?? null;
  const { has } = useAccount();
  const canShare = has('caregiver_link');
  const [room, setRoom] = useState(() => generateRoomCode());
  // Watching needs no plan, so a Free account starts on the side it can use.
  const [role, setRole] = useState<CaregiverRole>(() => (canShare ? 'speaker' : 'caregiver'));
  const speakerLocked = role === 'speaker' && !canShare;
  const [emergencyNote, setEmergencyNote] = useState('');
  const ids = { room: useId(), role: useId() };
  const active = link !== null && link.status !== 'closed';
  const phoneLink = websiteUrl(`alert?room=${encodeURIComponent(room)}`);
  const emergency = alerts.find((alert) => alert.kind === 'emergency' && Date.now() - alert.timestamp < EMERGENCY_BANNER_MS);

  const connect = (event: FormEvent) => {
    event.preventDefault();
    const code = room.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(code) || speakerLocked) return;
    setRoom(code);
    connectCaregiver(code, role);
  };

  return (
    <div className="space-y-6">
      {emergency && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-warn bg-warn/15 p-5">
          <Siren aria-hidden className="mt-0.5 size-7 shrink-0 text-warn" />
          <div className="min-w-0">
            <p className="font-display text-xl font-bold text-ink">Emergency alert{emergency.origin === 'phone' ? ' from the speaker’s phone' : ''}</p>
            <p className="mt-1 text-ink">{emergency.message}</p>
            <p className="mt-1 text-sm text-mist">{new Date(emergency.timestamp).toLocaleTimeString()}</p>
          </div>
        </div>
      )}
      <section aria-labelledby="pair-heading" className="glass rounded-2xl p-5">
        <h2 id="pair-heading" className="text-xl font-semibold text-ink">
          Pair devices
        </h2>
        <p className="mt-1 max-w-prose text-mist">
          Both devices enter the same room code. The speaker&apos;s app streams volume, pitch, strain and alerts straight to the
          caregiver&apos;s device; the backend only introduces the two.
        </p>
        <form onSubmit={connect} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={ids.room} className="text-sm font-bold text-mist">
              Room code
            </label>
            <div className="flex gap-2">
              <input id={ids.room} value={room} onChange={(event) => setRoom(event.target.value.toUpperCase())} disabled={active} className={cn(inputStyles, 'w-40 font-display text-lg tracking-widest')} />
              <button type="button" onClick={() => void navigator.clipboard?.writeText(room)} aria-label="Copy room code" className={buttonStyles.secondary}>
                <Copy aria-hidden className="size-4" />
              </button>
            </div>
          </div>
          <div>
            <label htmlFor={ids.role} className="text-sm font-bold text-mist">
              This device is the
            </label>
            <select id={ids.role} value={role} onChange={(event) => setRole(event.target.value as CaregiverRole)} disabled={active} className={inputStyles}>
              <option value="speaker">{canShare ? 'speaker' : 'speaker (Pro)'}</option>
              <option value="caregiver">caregiver</option>
            </select>
          </div>
          {active ? (
            <button type="button" onClick={disconnectCaregiver} className={buttonStyles.secondary}>
              <Link2Off aria-hidden className="size-4" />
              Disconnect
            </button>
          ) : (
            <button type="submit" disabled={backendOnline === false || speakerLocked} className={buttonStyles.primary}>
              <Link2 aria-hidden className="size-4" />
              Connect
            </button>
          )}
        </form>
        {speakerLocked && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              Sharing as the speaker is part of Voicematics Pro <ProBadge />
            </p>
            <p className="mt-1 max-w-prose text-sm text-mist">
              Anyone can watch as the caregiver for free. To stream your own voice measurements, sentences and emergency alerts
              to a caregiver, upgrade your plan.
            </p>
            <div className="mt-3">
              <UpgradeActions compact />
            </div>
          </div>
        )}
        <p className="mt-3 flex items-center gap-2 text-sm text-mist">
          <Radio aria-hidden className={cn('size-4', link?.status === 'connected' ? 'text-neon-cyan' : '')} />
          {link ? STATUS_TEXT[link.status] : 'Not connected'}
          {link?.roundTripMs !== null && link?.roundTripMs !== undefined && ` · ${link.roundTripMs} ms round trip`}
          {link && link.queued > 0 && ` · ${link.queued} waiting to send`}
          {link?.error && <span className="text-warn"> · {link.error}</span>}
        </p>
      </section>

      {role === 'speaker' && canShare && (
        <section aria-label="Sharing" className="space-y-4">
          <p className="glass flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm text-mist">
            <span>Your caregiver needs no app: send them this link and they can watch from any browser.</span>
            <code className="rounded bg-black/30 px-2 py-1 text-ink">{websiteUrl(`caregiver?room=${encodeURIComponent(room)}`)}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(websiteUrl(`caregiver?room=${encodeURIComponent(room)}`))}
              className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}
            >
              <Copy aria-hidden className="size-4" />
              Copy link
            </button>
          </p>
          <p className="glass flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm text-mist">
            <Smartphone aria-hidden className="size-4 text-neon-cyan" />
            <span>Alert button for your phone: open this link on your phone and sign in. Alerts reach your caregiver even when this app is closed.</span>
            <code className="rounded bg-black/30 px-2 py-1 text-ink">{phoneLink}</code>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(phoneLink)} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
              <Copy aria-hidden className="size-4" />
              Copy link
            </button>
          </p>
          <TelemetryBar source={telemetry} peer={peer} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setEmergencyNote(EMERGENCY_NOTES[sendEmergency() ?? 'none'])} className={buttonStyles.danger}>
              <Siren aria-hidden className="size-4" />
              Send emergency alert now
            </button>
            <p aria-live="polite" className="text-sm text-mist">
              {emergencyNote}
            </p>
          </div>
        </section>
      )}

      {role === 'caregiver' && (
        <section aria-label="Speaker telemetry" className="space-y-4">
          {link?.status === 'connected' ? (
            <PitchModeDashboard
              source={remoteTelemetry}
              peer={peer}
              grammar={latestTranscript?.grammar ?? null}
              grammarSource={latestTranscript?.source ?? null}
              grammarRoundTripMs={latestTranscript?.roundTripMs ?? null}
            />
          ) : (
            <p className="glass rounded-2xl px-5 py-6 text-mist">The speaker&apos;s telemetry appears here once both devices are in the room.</p>
          )}
        </section>
      )}

      {role === 'caregiver' && (
        <section aria-labelledby="transcripts-heading" className="glass rounded-2xl p-5">
          <h2 id="transcripts-heading" className="text-xl font-semibold text-ink">
            Sentences from the speaker
          </h2>
          {remoteTranscripts.length === 0 ? (
            <p className="mt-2 text-mist">Rebuilt sentences arrive here as the speaker talks or types.</p>
          ) : (
            <ol aria-live="polite" className="mt-3 flex flex-col gap-2">
              {remoteTranscripts.map((transcript) => (
                <li key={transcript.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <span className="min-w-0 flex-1 font-display text-lg text-ink">{transcript.grammar.formattedText}</span>
                  <span className="shrink-0 text-sm tabular-nums text-mist">
                    {transcript.source === 'demo' ? 'Demo, ' : ''}
                    {new Date(transcript.timestamp).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section aria-labelledby="alerts-heading" className="glass rounded-2xl p-5">
        <h2 id="alerts-heading" className="text-xl font-semibold text-ink">
          Alerts
        </h2>
        {alerts.length === 0 ? (
          <p className="mt-2 text-mist">No alerts yet. Vocal blocks, strain warnings, emergencies and trigger alerts show here.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {alerts.map((alert) => (
              <li key={alert.id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2', alert.kind === 'emergency' ? 'border-warn/60 bg-warn/10' : 'border-white/10 bg-white/[0.03]')}>
                <TriangleAlert aria-hidden className={cn('size-4 shrink-0', alert.kind === 'emergency' ? 'text-warn' : 'text-neon-blue')} />
                <span className="min-w-0 flex-1 text-ink">
                  <span className="font-semibold">{ALERT_LABELS[alert.kind]}</span>: {alert.message}
                  {alert.durationMs !== undefined && <span className="text-mist"> ({(alert.durationMs / 1000).toFixed(1)} s)</span>}
                  {alert.origin === 'phone' && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-mist">
                      <Smartphone aria-hidden className="size-3" />
                      from phone
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-mist">{new Date(alert.timestamp).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
