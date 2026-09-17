/**
 * Caregiver link: one WebRTC data channel between the speaker's app and a
 * caregiver's device, brokered by the backend's signalling relay
 * (`/ws/signal/{room}`). Telemetry, alerts and reconstructed sentences travel
 * peer-to-peer; the relay only ever sees offer/answer/ICE.
 *
 * Either side may connect first. The speaker makes the offer as soon as both
 * are in the room; a ping/pong every two seconds measures the round trip.
 * `send` is best effort (live telemetry); `broadcast` queues alerts and
 * sentences in an Outbox until the channel opens.
 *
 * The signalling socket reconnects on its own, even while the data channel is
 * up, and identifies the device with `clientId` so the relay lets it take its
 * role back from a connection it has not yet noticed is gone.
 *
 * Alerts raised on the speaker's phone arrive over the signalling socket instead
 * (the relay passes them on) and reach `onMessage` like any other alert.
 */

import type { CaregiverMessage, CaregiverRole, SignalMessage } from '@shared/types';
import type { PeerLinkState, PeerStatus } from '@/lib/hud/types';
import { parseCaregiverMessage } from '@/lib/peer/messages';
import { Outbox, type Delivery, type OutboxChannel } from '@/lib/peer/outbox';

export type LinkStatus = 'idle' | 'signalling' | 'waiting' | 'connecting' | 'connected' | 'error' | 'closed';

export interface CaregiverLinkState {
  status: LinkStatus;
  role: CaregiverRole;
  room: string;
  peerPresent: boolean;
  roundTripMs: number | null;
  error: string | null;
  /** Messages sent / received over the data channel. */
  sent: number;
  received: number;
  /** Alerts and sentences waiting for the data channel to open. */
  queued: number;
}

export interface CaregiverLinkOptions {
  role: CaregiverRole;
  room: string;
  /** ws(s):// origin of the backend. */
  signalUrl: string;
  iceServers: RTCIceServer[];
  /** Stable for this device across reconnects; 8-64 letters, digits, - or _. Generated when omitted. */
  clientId?: string;
  /** The Voicematics session token, read on every (re)connect. The speaker needs one on a Pro plan. */
  getAuthToken?: () => string | null;
  onMessage: (message: CaregiverMessage) => void;
  onState: (state: CaregiverLinkState) => void;
}

type WireMessage = CaregiverMessage | { type: 'ping'; at: number } | { type: 'pong'; at: number };

const CHANNEL_LABEL = 'omnivoice';
const PING_INTERVAL_MS = 2000;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECTS = 5;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_PLAN_REQUIRED = 4402;
const CLOSE_ROLE_TAKEN = 4409;
const CLOSE_REPLACED = 4410;
const SIGNAL_PROTOCOL = 'voicematics.signal';
const TOKEN_PROTOCOL_PREFIX = 'voicematics.token.';
const BUFFERED_LOW_BYTES = 256 * 1024;

export const PEER_LABELS: Record<CaregiverRole, string> = {
  speaker: 'Speaker',
  caregiver: 'Caregiver device',
};

export class CaregiverLink {
  private socket: WebSocket | null = null;
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnects = 0;
  private closedByUser = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private readonly outbox = new Outbox();
  private readonly clientId: string;
  private sentCount = 0;

  private state: CaregiverLinkState;

  constructor(private readonly options: CaregiverLinkOptions) {
    this.clientId = options.clientId ?? generateClientId();
    this.state = {
      status: 'idle',
      role: options.role,
      room: options.room,
      peerPresent: false,
      roundTripMs: null,
      error: null,
      sent: 0,
      received: 0,
      queued: 0,
    };
  }

  getState(): CaregiverLinkState {
    return this.state;
  }

  private update(patch: Partial<CaregiverLinkState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  private openSocket(): void {
    const { signalUrl, room, role } = this.options;
    // Reconnecting the relay while the data channel is open must not report the link as down.
    this.update(this.connected ? { error: null } : { status: 'signalling', error: null });
    let socket: WebSocket;
    // The token travels as a subprotocol, so it never appears in a URL or an access log.
    const token = this.options.getAuthToken?.() ?? null;
    const protocols = token ? [SIGNAL_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${token}`] : [SIGNAL_PROTOCOL];
    try {
      socket = new WebSocket(
        `${signalUrl}/ws/signal/${encodeURIComponent(room)}?role=${role}&client=${encodeURIComponent(this.clientId)}`,
        protocols,
      );
    } catch (error) {
      this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnects = 0;
      if (!this.connected) this.update({ status: 'waiting' });
    };
    socket.onmessage = (event) => {
      let message: SignalMessage;
      try {
        message = JSON.parse(String(event.data)) as SignalMessage;
      } catch {
        return;
      }
      void this.handleSignal(message);
    };
    socket.onerror = () => {
      // The close handler carries the useful information.
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closedByUser) return;
      if (event.code === CLOSE_ROLE_TAKEN) {
        this.update({ status: 'error', error: `Someone is already connected as the ${role} in room ${room}.` });
        return;
      }
      if (event.code === CLOSE_UNAUTHORIZED) {
        this.update({ status: 'error', error: 'Sign in to your Voicematics account to share as the speaker.' });
        return;
      }
      if (event.code === CLOSE_PLAN_REQUIRED) {
        this.update({ status: 'error', error: 'Sharing as the speaker is part of Voicematics Pro.' });
        return;
      }
      // A newer connection from this device took over; it owns the link now.
      if (event.code === CLOSE_REPLACED) return;
      // Keep signalling even while the data channel is up, so a later renegotiation can reach the peer.
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnects >= MAX_RECONNECTS) {
      const error = 'Could not reach the signalling server. Check the backend URL in Settings.';
      // A working data channel carries on without the relay.
      this.update(this.connected ? { error } : { status: 'error', error });
      return;
    }
    this.reconnects++;
    if (!this.connected) this.update({ status: 'signalling', error: null });
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS);
  }

  private sendSignal(message: SignalMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async handleSignal(message: SignalMessage): Promise<void> {
    switch (message.type) {
      // An open channel survives a signalling reconnect on either side, so only offer when there is none.
      case 'joined':
        this.update({ peerPresent: message.peerPresent, error: null });
        if (message.peerPresent && this.options.role === 'speaker' && !this.connected) await this.offer();
        break;
      case 'peer-joined':
        this.update({ peerPresent: true });
        if (this.options.role === 'speaker' && !this.connected) await this.offer();
        break;
      case 'peer-left':
        this.update({ peerPresent: false, roundTripMs: null });
        this.teardownConnection();
        this.update({ status: this.socket ? 'waiting' : 'signalling' });
        if (!this.socket && !this.closedByUser) this.scheduleReconnect();
        break;
      case 'offer':
        if (this.options.role !== 'caregiver') return;
        await this.answer(message.sdp);
        break;
      case 'answer': {
        const connection = this.connection;
        if (!connection || this.options.role !== 'speaker') return;
        await connection.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        await this.flushIce();
        break;
      }
      case 'alert': {
        const parsed = parseCaregiverMessage(message);
        if (!parsed) break;
        this.options.onMessage(parsed);
        // The relay keeps a phone alert until a caregiver confirms it, so a dropped connection cannot lose it.
        if (this.options.role === 'caregiver') this.sendSignal({ type: 'alert-ack', id: message.alert.id });
        break;
      }
      case 'ice': {
        const candidate: RTCIceCandidateInit = {
          candidate: message.candidate,
          sdpMid: message.sdpMid ?? undefined,
          sdpMLineIndex: message.sdpMLineIndex ?? undefined,
        };
        if (this.connection?.remoteDescription) await this.connection.addIceCandidate(candidate).catch(() => undefined);
        else this.pendingIce.push(candidate);
        break;
      }
      default:
        break;
    }
  }

  private async flushIce(): Promise<void> {
    const connection = this.connection;
    if (!connection) return;
    const pending = this.pendingIce.splice(0, this.pendingIce.length);
    for (const candidate of pending) await connection.addIceCandidate(candidate).catch(() => undefined);
  }

  private createConnection(): RTCPeerConnection {
    this.teardownConnection();
    const connection = new RTCPeerConnection({ iceServers: this.options.iceServers });
    this.connection = connection;
    this.update({ status: 'connecting' });

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendSignal({
        type: 'ice',
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      });
    };
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.update({ status: this.closedByUser ? 'closed' : 'waiting', roundTripMs: null });
        this.stopPing();
        if (state === 'failed' && !this.closedByUser && this.options.role === 'speaker' && this.state.peerPresent) {
          void this.offer();
        }
      }
    };
    connection.ondatachannel = (event) => this.attachChannel(event.channel);
    return connection;
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.bufferedAmountLowThreshold = BUFFERED_LOW_BYTES;
    channel.onopen = () => {
      this.update({ status: 'connected', error: null });
      this.startPing();
      this.flushOutbox();
    };
    channel.onbufferedamountlow = () => this.flushOutbox();
    channel.onclose = () => {
      if (this.channel === channel) this.channel = null;
      this.stopPing();
      if (!this.closedByUser) this.update({ status: 'waiting', roundTripMs: null });
    };
    channel.onmessage = (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const wire = raw as { type?: unknown; at?: unknown };
      if (wire?.type === 'ping' || wire?.type === 'pong') {
        if (typeof wire.at !== 'number' || !Number.isFinite(wire.at)) return;
        if (wire.type === 'ping') this.sendWire({ type: 'pong', at: wire.at });
        else this.update({ roundTripMs: Math.max(0, Math.round(performance.now() - wire.at)) });
        return;
      }
      // The peer is another app instance: drop anything malformed before it reaches the HUD.
      const message = parseCaregiverMessage(raw);
      if (!message) return;
      this.update({ received: this.state.received + 1 });
      this.options.onMessage(message);
    };
  }

  private async offer(): Promise<void> {
    const connection = this.createConnection();
    this.attachChannel(connection.createDataChannel(CHANNEL_LABEL, { ordered: true }));
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: offer.sdp ?? '' });
  }

  private async answer(sdp: string): Promise<void> {
    const connection = this.createConnection();
    await connection.setRemoteDescription({ type: 'offer', sdp });
    await this.flushIce();
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    this.sendSignal({ type: 'answer', sdp: answer.sdp ?? '' });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.sendWire({ type: 'ping', at: performance.now() }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private sendWire(message: WireMessage): boolean {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return false;
    channel.send(JSON.stringify(message));
    return true;
  }

  /** Best effort, for live telemetry: false when the channel is not open. */
  send(message: CaregiverMessage): boolean {
    const sent = this.sendWire(message);
    if (sent) this.update({ sent: ++this.sentCount });
    return sent;
  }

  /** Alerts and sentences: sent in order now, or queued until the channel opens. */
  broadcast(message: CaregiverMessage): Delivery {
    const delivery = this.outbox.deliver(JSON.stringify(message), this.countingChannel());
    this.update({ sent: this.sentCount, queued: this.outbox.size });
    return delivery;
  }

  private flushOutbox(): void {
    const channel = this.countingChannel();
    if (!channel || this.outbox.size === 0) return;
    this.outbox.flush(channel);
    this.update({ sent: this.sentCount, queued: this.outbox.size });
  }

  /** The data channel, counting what the outbox sends through it. */
  private countingChannel(): OutboxChannel | null {
    const channel = this.channel;
    if (!channel) return null;
    return {
      get readyState() {
        return channel.readyState;
      },
      get bufferedAmount() {
        return channel.bufferedAmount;
      },
      send: (data: string) => {
        channel.send(data);
        this.sentCount++;
      },
    };
  }

  get connected(): boolean {
    return this.channel?.readyState === 'open';
  }

  private teardownConnection(): void {
    this.stopPing();
    this.channel?.close();
    this.channel = null;
    this.connection?.close();
    this.connection = null;
    this.pendingIce = [];
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownConnection();
    this.socket?.close();
    this.socket = null;
    this.outbox.clear();
    this.update({ status: 'closed', peerPresent: false, roundTripMs: null, queued: 0 });
  }
}

export function toPeerLinkState(state: CaregiverLinkState | null): PeerLinkState {
  if (!state) return { status: 'disconnected', peerLabel: 'No device', roundTripMs: null };
  const other: CaregiverRole = state.role === 'speaker' ? 'caregiver' : 'speaker';
  const status: PeerStatus =
    state.status === 'connected' ? 'connected' : state.status === 'connecting' || state.status === 'signalling' || state.status === 'waiting' ? 'connecting' : 'disconnected';
  return { status, peerLabel: `${PEER_LABELS[other]} (${state.room})`, roundTripMs: state.roundTripMs };
}

/** Six characters from an unambiguous alphabet, e.g. "K7P3XQ". */
export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

/** 24 characters from the same alphabet; the relay accepts 8-64 letters, digits, - or _. */
export function generateClientId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
