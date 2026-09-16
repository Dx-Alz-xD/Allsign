/**
 * Caregiver link: one WebRTC data channel between the speaker's app and a
 * caregiver's device, brokered by the backend's signalling relay
 * (`/ws/signal/{room}`). Telemetry and alerts travel peer-to-peer; the relay
 * only ever sees offer/answer/ICE.
 *
 * Either side may connect first. The speaker makes the offer as soon as both
 * are in the room; a ping/pong every two seconds measures the round trip.
 */

import type { CaregiverMessage, CaregiverRole, SignalMessage } from '@shared/types';
import type { PeerLinkState, PeerStatus } from '@/lib/hud/types';

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
}

export interface CaregiverLinkOptions {
  role: CaregiverRole;
  room: string;
  /** ws(s):// origin of the backend. */
  signalUrl: string;
  iceServers: RTCIceServer[];
  onMessage: (message: CaregiverMessage) => void;
  onState: (state: CaregiverLinkState) => void;
}

type WireMessage = CaregiverMessage | { type: 'ping'; at: number } | { type: 'pong'; at: number };

const CHANNEL_LABEL = 'omnivoice';
const PING_INTERVAL_MS = 2000;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECTS = 5;
const CLOSE_ROLE_TAKEN = 4409;

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

  private state: CaregiverLinkState;

  constructor(private readonly options: CaregiverLinkOptions) {
    this.state = {
      status: 'idle',
      role: options.role,
      room: options.room,
      peerPresent: false,
      roundTripMs: null,
      error: null,
      sent: 0,
      received: 0,
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
    this.update({ status: 'signalling', error: null });
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${signalUrl}/ws/signal/${encodeURIComponent(room)}?role=${role}`);
    } catch (error) {
      this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnects = 0;
      this.update({ status: 'waiting' });
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
      if (this.state.status === 'connected') return; // the data channel outlives the signalling socket
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnects >= MAX_RECONNECTS) {
      this.update({ status: 'error', error: 'Could not reach the signalling server. Check the backend URL in Settings.' });
      return;
    }
    this.reconnects++;
    this.update({ status: 'signalling', error: null });
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS);
  }

  private sendSignal(message: SignalMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async handleSignal(message: SignalMessage): Promise<void> {
    switch (message.type) {
      case 'joined':
        this.update({ peerPresent: message.peerPresent });
        if (message.peerPresent && this.options.role === 'speaker') await this.offer();
        break;
      case 'peer-joined':
        this.update({ peerPresent: true });
        if (this.options.role === 'speaker') await this.offer();
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
    channel.onopen = () => {
      this.update({ status: 'connected', error: null });
      this.startPing();
    };
    channel.onclose = () => {
      if (this.channel === channel) this.channel = null;
      this.stopPing();
      if (!this.closedByUser) this.update({ status: 'waiting', roundTripMs: null });
    };
    channel.onmessage = (event) => {
      let message: WireMessage;
      try {
        message = JSON.parse(String(event.data)) as WireMessage;
      } catch {
        return;
      }
      if (message.type === 'ping') {
        this.sendWire({ type: 'pong', at: message.at });
        return;
      }
      if (message.type === 'pong') {
        this.update({ roundTripMs: Math.max(0, Math.round(performance.now() - message.at)) });
        return;
      }
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

  /** Sends a telemetry or alert message; false when the channel is not open. */
  send(message: CaregiverMessage): boolean {
    const sent = this.sendWire(message);
    if (sent) this.update({ sent: this.state.sent + 1 });
    return sent;
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
    this.update({ status: 'closed', peerPresent: false, roundTripMs: null });
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
