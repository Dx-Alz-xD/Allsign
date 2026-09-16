import type { NetworkSettings } from '@/lib/settings/schema';

const HOST = String.raw`(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)`;
const PORT = String.raw`(?::(\d{1,5}))?`;
const STUN_PATTERN = new RegExp(`^stuns?:${HOST}${PORT}$`, 'i');
const TURN_PATTERN = new RegExp(`^turns?:${HOST}${PORT}(?:\\?transport=(?:udp|tcp))?$`, 'i');

function portInRange(url: string): boolean {
  const port = /:(\d{1,5})(?:\?|$)/.exec(url)?.[1];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
}

/** Returns an error message, or null when the URL is valid. */
export function validateStunUrl(url: string): string | null {
  if (!STUN_PATTERN.test(url) || !portInRange(url)) {
    return 'Use the form stun:host:port, for example stun:stun.l.google.com:19302.';
  }
  return null;
}

export function validateTurnUrl(url: string): string | null {
  if (!TURN_PATTERN.test(url) || !portInRange(url)) {
    return 'Use the form turn:host:port, for example turn:relay.example.com:3478?transport=udp.';
  }
  return null;
}

export interface NetworkValidation {
  stun: Array<{ url: string; error: string | null }>;
  turnUrl: string | null;
  turnUsername: string | null;
  turnCredential: string | null;
  valid: boolean;
}

export function validateNetworkSettings(settings: NetworkSettings): NetworkValidation {
  const stun = settings.stunUrls.map((url) => ({ url, error: validateStunUrl(url) }));
  const hasTurn = settings.turnUrl.trim() !== '';
  const turnUrl = hasTurn ? validateTurnUrl(settings.turnUrl.trim()) : null;
  const turnUsername = hasTurn && settings.turnUsername.trim() === '' ? 'Enter the username for this relay.' : null;
  const turnCredential = hasTurn && settings.turnCredential === '' ? 'Enter the password or credential for this relay.' : null;
  return {
    stun,
    turnUrl,
    turnUsername,
    turnCredential,
    valid: stun.every((entry) => entry.error === null) && !turnUrl && !turnUsername && !turnCredential,
  };
}

/** ICE servers for the caregiver WebRTC connection. */
export function iceServersFrom(settings: NetworkSettings): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  if (settings.stunUrls.length > 0) servers.push({ urls: settings.stunUrls });
  if (settings.turnUrl) {
    servers.push({ urls: settings.turnUrl, username: settings.turnUsername, credential: settings.turnCredential });
  }
  return servers;
}

/** Host and port without the scheme or query, for plain-language display. */
export function serverHost(url: string): string {
  return url.replace(/^(stuns?|turns?):/i, '').replace(/\?.*$/, '');
}

export type ProbeResult = 'working' | 'no-response' | 'not-configured' | 'error';

/**
 * Starts a throwaway peer connection and waits for a candidate of the given type: `srflx` proves a
 * STUN server answered, `relay` proves a TURN server allocated a relay with these credentials.
 */
async function probe(config: RTCConfiguration, want: RTCIceCandidateType, timeoutMs: number): Promise<ProbeResult> {
  let connection: RTCPeerConnection;
  try {
    connection = new RTCPeerConnection(config);
  } catch {
    return 'error';
  }

  try {
    connection.createDataChannel('probe');
    return await new Promise<ProbeResult>((resolve) => {
      const timer = window.setTimeout(() => resolve('no-response'), timeoutMs);
      const finish = (result: ProbeResult) => {
        window.clearTimeout(timer);
        resolve(result);
      };
      connection.addEventListener('icecandidate', (event) => {
        if (!event.candidate) {
          finish('no-response');
          return;
        }
        const type = event.candidate.type ?? / typ (\w+)/.exec(event.candidate.candidate)?.[1];
        if (type === want) finish('working');
      });
      connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch(() => finish('error'));
    });
  } finally {
    connection.close();
  }
}

export async function probeNetworkSettings(
  settings: NetworkSettings,
  timeoutMs = 6000,
): Promise<{ stun: ProbeResult; turn: ProbeResult }> {
  const [stun, turn] = await Promise.all([
    settings.stunUrls.length > 0
      ? probe({ iceServers: [{ urls: settings.stunUrls }] }, 'srflx', timeoutMs)
      : Promise.resolve<ProbeResult>('not-configured'),
    settings.turnUrl
      ? probe(
          {
            iceServers: [{ urls: settings.turnUrl, username: settings.turnUsername, credential: settings.turnCredential }],
            iceTransportPolicy: 'relay',
          },
          'relay',
          timeoutMs,
        )
      : Promise.resolve<ProbeResult>('not-configured'),
  ]);
  return { stun, turn };
}
