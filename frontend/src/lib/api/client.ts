/**
 * Typed client for the FastAPI backend (Laptop 3). Every payload type comes
 * from shared/types.ts, which mirrors backend/schemas.py.
 */

import type {
  AcousticMatchRequest,
  AcousticMatchResponse,
  AcousticTriggerProfile,
  AcousticTriggerUpdate,
  GrammarRequest,
  GrammarResponse,
  PhonemeLookupResponse,
  PhonemeTarget,
  PhonemeTargetInput,
  ProfileMode,
  ProfilePreset,
  ProfilePresetInput,
  SessionAnalytics,
  SessionAnalyticsInput,
  SessionSummary,
} from '@shared/types';

export const DEFAULT_BACKEND_URL = 'http://localhost:8000';

export function backendUrl(): string {
  return (process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
}

/** ws(s):// origin of the backend, for the caregiver signalling relay. */
export function backendWebSocketUrl(): string {
  return backendUrl().replace(/^http/, 'ws');
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: unknown,
  ) {
    super(typeof detail === 'string' && detail ? detail : `${path} failed with status ${status}`);
    this.name = 'ApiError';
  }
}

/** GET /health/live: cheap liveness check, no parse. */
export interface LiveHealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  startedAt: string;
}

/** GET /health: also times a probe parse against the grammar engine's budget. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  startedAt: string;
  astEngine: { latencyMs: number; budgetMs: number; withinBudget: boolean };
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 5000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${backendUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let detail: unknown = null;
    try {
      detail = (await response.json()) as { detail?: unknown };
      if (detail && typeof detail === 'object' && 'detail' in detail) detail = (detail as { detail: unknown }).detail;
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new ApiError(response.status, path, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const query = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  health: () => request<LiveHealthResponse>('/health/live', {}, 3000),
  healthReport: () => request<HealthResponse>('/health', {}, 3000),

  grammar: {
    translate: (body: GrammarRequest) => request<GrammarResponse>('/api/grammar/translate', { method: 'POST', ...json(body) }),
  },

  triggers: {
    list: (params: { targetAction?: AcousticTriggerProfile['targetAction']; limit?: number; offset?: number } = {}) =>
      request<AcousticTriggerProfile[]>(`/api/triggers${query(params)}`),
    create: (body: Omit<AcousticTriggerProfile, 'id'>) =>
      request<AcousticTriggerProfile>('/api/triggers', { method: 'POST', ...json(body) }),
    update: (id: string, body: AcousticTriggerUpdate) =>
      request<AcousticTriggerProfile>(`/api/triggers/${encodeURIComponent(id)}`, { method: 'PATCH', ...json(body) }),
    remove: (id: string) => request<void>(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    match: (body: AcousticMatchRequest) => request<AcousticMatchResponse>('/api/triggers/match', { method: 'POST', ...json(body) }),
  },

  presets: {
    list: (mode?: ProfileMode) => request<ProfilePreset[]>(`/api/presets${query({ mode })}`),
    create: (body: ProfilePresetInput) => request<ProfilePreset>('/api/presets', { method: 'POST', ...json(body) }),
    replace: (id: string, body: ProfilePresetInput) =>
      request<ProfilePreset>(`/api/presets/${encodeURIComponent(id)}`, { method: 'PUT', ...json(body) }),
    remove: (id: string) => request<void>(`/api/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  sessions: {
    list: (params: { profileMode?: ProfileMode; limit?: number; offset?: number } = {}) =>
      request<SessionAnalytics[]>(`/api/sessions${query(params)}`),
    summary: (profileMode?: ProfileMode) => request<SessionSummary>(`/api/sessions/summary${query({ profileMode })}`),
    record: (body: SessionAnalyticsInput) => request<SessionAnalytics>('/api/sessions', { method: 'POST', ...json(body) }),
    remove: (id: string) => request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  phonemes: {
    targets: () => request<PhonemeTarget[]>('/api/phonemes/targets'),
    createTarget: (body: PhonemeTargetInput) => request<PhonemeTarget>('/api/phonemes/targets', { method: 'POST', ...json(body) }),
    removeTarget: (id: string) => request<void>(`/api/phonemes/targets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    lookup: (prefix: string, limit = 10) => request<PhonemeLookupResponse>(`/api/phonemes/lookup${query({ prefix, limit })}`),
  },
};

export type Api = typeof api;
