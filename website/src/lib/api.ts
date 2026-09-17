/**
 * The website's client for the FastAPI backend: accounts, licences, billing and the grammar engine.
 * Every contract is defined once in shared/types.ts and mirrored by backend/schemas.py.
 */

import type {
  AccountResponse,
  AuthCredentials,
  AuthSessionResponse,
  CheckoutRequest,
  CheckoutResponse,
  GrammarRequest,
  GrammarResponse,
  PricingPlan,
  Subscription,
} from '@shared/types';

export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

export function backendUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  return (configured || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
}

/** ws(s):// origin of the backend, for the caregiver signalling relay. */
export function backendWebSocketUrl(): string {
  return backendUrl().replace(/^http/, 'ws');
}

/** STUN/TURN servers for the caregiver link, from NEXT_PUBLIC_STUN_SERVER and NEXT_PUBLIC_TURN_*. */
export function iceServers(): RTCIceServer[] {
  const stun = (process.env.NEXT_PUBLIC_STUN_SERVER || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const servers: RTCIceServer[] = stun.length ? [{ urls: stun }] : [];
  const turn = process.env.NEXT_PUBLIC_TURN_URL?.trim();
  if (turn) servers.push({ urls: turn, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL });
  return servers;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      const first = body.detail[0] as { msg?: string; loc?: unknown[] } | undefined;
      if (first?.msg) return `${(first.loc ?? []).slice(1).join('.')}: ${first.msg}`;
    }
  } catch {
    // Not JSON; fall through to the status text.
  }
  return response.statusText || `Request failed (${response.status})`;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${backendUrl()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Voicematics could not reach its server. If it was idle it is waking up now; try again in a moment.');
  }
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    throw new ApiError(response.status, await readDetail(response), retry ? Number(retry) : null);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  health: () => request<{ status: string }>('/health/live'),
  grammar: (body: GrammarRequest) => request<GrammarResponse>('/api/grammar/translate', json(body)),
  auth: {
    signup: (body: AuthCredentials) => request<AuthSessionResponse>('/api/auth/signup', json(body)),
    login: (body: AuthCredentials) => request<AuthSessionResponse>('/api/auth/login', json(body)),
    me: (token: string) => request<AccountResponse>('/api/auth/me', {}, token),
  },
  billing: {
    plans: () => request<PricingPlan[]>('/api/billing/plans'),
    subscription: (token: string) => request<Subscription | null>('/api/billing/subscription', {}, token),
    checkout: (body: CheckoutRequest, token: string) => request<CheckoutResponse>('/api/billing/checkout', json(body), token),
  },
};
