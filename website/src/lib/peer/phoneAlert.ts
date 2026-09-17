/**
 * The speaker's phone as an alert button: joins the speaker's room on the signalling relay as `alerter` and sends
 * alerts over that socket. There is no WebRTC here; the relay hands each alert to the caregiver (and the speaker's
 * desktop app) and keeps it, for up to 10 minutes, until a caregiver's dashboard confirms it. See
 * backend/routers/signalling.py.
 */

import type { PhoneAlertRequest, SignalMessage } from '@shared/types';
import { generateClientId } from '@/lib/peer/caregiverLink';

export type PhoneLinkStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'stopped';

export interface PhoneLinkState {
  status: PhoneLinkStatus;
  /** Whether a caregiver is in the room right now. */
  caregiverPresent: boolean;
  /** Why the relay closed the connection for good (wrong account, no plan, ...), or the last connection problem. */
  error: string | null;
}

/** sent: a caregiver was in the room; held: none was, the server keeps it for them; delivered: their dashboard confirmed it. */
export type PhoneAlertOutcome = { status: 'sent' } | { status: 'held' } | { status: 'delivered' } | { status: 'failed'; message: string };

export interface PhoneAlertLinkOptions {
  room: string;
  /** ws(s):// origin of the backend. */
  signalUrl: string;
  token: string;
  clientId?: string;
  onState: (state: PhoneLinkState) => void;
  /** An alert passed to `send` was answered: `localId` is the id `send` returned. */
  onOutcome: (localId: string, outcome: PhoneAlertOutcome) => void;
}

const SIGNAL_PROTOCOL = 'voicematics.signal';
const TOKEN_PROTOCOL_PREFIX = 'voicematics.token.';
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
/** Close codes after which retrying cannot help: no session, no plan, not the speaker's account, bad room, replaced. */
const FINAL_CLOSE_CODES = new Set([4400, 4401, 4402, 4403, 4409, 4410]);

export class PhoneAlertLink {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private counter = 0;
  /** Alerts pressed while the socket was not open, sent in order once it opens. */
  private outbox: Array<{ localId: string; request: PhoneAlertRequest }> = [];
  /** Sent and waiting for the relay's answer, oldest first: the relay answers in order. */
  private awaiting: string[] = [];
  /** The relay's id for each alert it accepted, for its later `alert-received`. */
  private accepted = new Map<string, string>();
  /** Acknowledgements that beat the relay's own `alert-sent` answer to this phone. */
  private receivedEarly = new Set<string>();
  private readonly clientId: string;
  private state: PhoneLinkState = { status: 'idle', caregiverPresent: false, error: null };

  constructor(private readonly options: PhoneAlertLinkOptions) {
    this.clientId = options.clientId ?? generateClientId();
  }

  private update(patch: Partial<PhoneLinkState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.failPending('The alert button was closed before the alert went out.');
    this.update({ status: 'stopped' });
  }

  /** Sends now, or as soon as the connection opens. Returns an id that `onOutcome` reports on. */
  send(kind: PhoneAlertRequest['kind'], message: string): string {
    this.counter += 1;
    const localId = `local-${Date.now()}-${this.counter}`;
    const request: PhoneAlertRequest = { type: 'alert', kind, message };
    if (this.socket?.readyState === WebSocket.OPEN) this.transmit(localId, request);
    else this.outbox.push({ localId, request });
    return localId;
  }

  private transmit(localId: string, request: PhoneAlertRequest): void {
    this.socket?.send(JSON.stringify(request));
    this.awaiting.push(localId);
  }

  private open(): void {
    const { signalUrl, room, token } = this.options;
    const url = `${signalUrl}/ws/signal/${encodeURIComponent(room)}?role=alerter&client=${encodeURIComponent(this.clientId)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, [SIGNAL_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`]);
    } catch (error) {
      this.update({ status: 'stopped', error: error instanceof Error ? error.message : 'Could not open the connection.' });
      return;
    }
    this.socket = socket;
    this.update({ status: this.attempt === 0 ? 'connecting' : 'reconnecting' });

    socket.onmessage = (event) => {
      let message: SignalMessage;
      try {
        message = JSON.parse(String(event.data)) as SignalMessage;
      } catch {
        return;
      }
      this.handle(message);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      // An alert sent on this socket without an answer may or may not have gone out; say so rather than resend it.
      this.failPending('The connection dropped before the server confirmed this alert. Send it again if it matters.');
      if (this.stopped) return;
      if (FINAL_CLOSE_CODES.has(event.code)) {
        this.stopped = true;
        this.failOutbox(event.reason || 'The server closed the connection.');
        this.update({ status: 'stopped', caregiverPresent: false, error: event.reason || 'The server closed the connection.' });
        return;
      }
      const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
      this.attempt += 1;
      this.update({ status: 'reconnecting', caregiverPresent: false, error: 'Reconnecting to the server. A sleeping server can take up to a minute to wake.' });
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.stopped) this.open();
      }, delay);
    };
  }

  private handle(message: SignalMessage): void {
    switch (message.type) {
      case 'joined': {
        this.attempt = 0;
        this.update({ status: 'ready', caregiverPresent: message.peerPresent, error: null });
        const queued = this.outbox;
        this.outbox = [];
        for (const item of queued) this.transmit(item.localId, item.request);
        return;
      }
      case 'peer-joined':
        if (message.role === 'caregiver') this.update({ caregiverPresent: true });
        return;
      case 'peer-left':
        if (message.role === 'caregiver') this.update({ caregiverPresent: false });
        return;
      case 'alert-sent': {
        const localId = this.awaiting.shift();
        if (!localId) return;
        if (this.receivedEarly.delete(message.id)) {
          this.options.onOutcome(localId, { status: 'delivered' });
          return;
        }
        this.accepted.set(message.id, localId);
        this.options.onOutcome(localId, message.delivered ? { status: 'sent' } : { status: 'held' });
        return;
      }
      case 'alert-received': {
        const localId = this.accepted.get(message.id);
        this.accepted.delete(message.id);
        if (localId) this.options.onOutcome(localId, { status: 'delivered' });
        else if (this.awaiting.length > 0) this.receivedEarly.add(message.id);
        return;
      }
      case 'error': {
        const localId = this.awaiting.shift();
        if (localId) this.options.onOutcome(localId, { status: 'failed', message: message.message });
        else this.update({ error: message.message });
        return;
      }
      default:
        return;
    }
  }

  private failPending(message: string): void {
    const pending = this.awaiting;
    this.awaiting = [];
    for (const localId of pending) this.options.onOutcome(localId, { status: 'failed', message });
  }

  private failOutbox(message: string): void {
    const queued = this.outbox;
    this.outbox = [];
    for (const item of queued) this.options.onOutcome(item.localId, { status: 'failed', message });
  }
}
