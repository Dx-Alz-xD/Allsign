'use client';

import { useId, useState, type FormEvent } from 'react';
import { Copy, Link2, Link2Off, Radio, Siren, TriangleAlert } from 'lucide-react';
import type { CaregiverRole } from '@shared/types';
import { buttonStyles } from '@/components/modals/Modal';
import { inputStyles } from '@/components/modals/settings/controls';
import { useSession } from '@/components/providers/SessionProvider';
import { PitchModeDashboard } from '@/components/PitchModeDashboard';
import { TelemetryBar } from '@/components/TelemetryBar';
import { generateRoomCode } from '@/lib/peer/caregiverLink';
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

const ALERT_LABELS = { 'vocal-block': 'Vocal block', fatigue: 'Vocal strain', emergency: 'Emergency', trigger: 'Trigger' } as const;

/** Pair two devices through a room code: the speaker shares telemetry, the caregiver watches. */
export function CaregiverView() {
  const { link, connectCaregiver, disconnectCaregiver, alerts, remoteTelemetry, peer, telemetry, sendEmergency, backendOnline } = useSession();
  const [room, setRoom] = useState(() => generateRoomCode());
  const [role, setRole] = useState<CaregiverRole>('speaker');
  const ids = { room: useId(), role: useId() };
  const active = link !== null && link.status !== 'closed';

  const connect = (event: FormEvent) => {
    event.preventDefault();
    const code = room.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(code)) return;
    setRoom(code);
    connectCaregiver(code, role);
  };

  return (
    <div className="space-y-6">
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
              <option value="speaker">speaker</option>
              <option value="caregiver">caregiver</option>
            </select>
          </div>
          {active ? (
            <button type="button" onClick={disconnectCaregiver} className={buttonStyles.secondary}>
              <Link2Off aria-hidden className="size-4" />
              Disconnect
            </button>
          ) : (
            <button type="submit" disabled={backendOnline === false} className={buttonStyles.primary}>
              <Link2 aria-hidden className="size-4" />
              Connect
            </button>
          )}
        </form>
        <p className="mt-3 flex items-center gap-2 text-sm text-mist">
          <Radio aria-hidden className={cn('size-4', link?.status === 'connected' ? 'text-neon-cyan' : '')} />
          {link ? STATUS_TEXT[link.status] : 'Not connected'}
          {link?.roundTripMs !== null && link?.roundTripMs !== undefined && ` · ${link.roundTripMs} ms round trip`}
          {link?.error && <span className="text-warn"> · {link.error}</span>}
        </p>
      </section>

      {role === 'speaker' && (
        <section aria-label="Sharing" className="space-y-4">
          <TelemetryBar source={telemetry} peer={peer} />
          <button type="button" onClick={sendEmergency} className={buttonStyles.danger}>
            <Siren aria-hidden className="size-4" />
            Send emergency alert now
          </button>
        </section>
      )}

      {role === 'caregiver' && (
        <section aria-label="Speaker telemetry" className="space-y-4">
          {link?.status === 'connected' ? (
            <PitchModeDashboard source={remoteTelemetry} peer={peer} grammar={null} />
          ) : (
            <p className="glass rounded-2xl px-5 py-6 text-mist">The speaker&apos;s telemetry appears here once both devices are in the room.</p>
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
