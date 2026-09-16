import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isPlanRequired, onSessionRejected, setAuthToken } from '../client';

function respond(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(status === 204 ? null : JSON.stringify(body), { status }));
}

afterEach(() => {
  setAuthToken(null);
  vi.unstubAllGlobals();
});

describe('api client sessions', () => {
  it('sends the session token and tells listeners when the backend rejects it', async () => {
    const fetch = respond(401, { detail: 'Your session is invalid or has expired. Sign in again.' });
    vi.stubGlobal('fetch', fetch);
    const rejected = vi.fn();
    const unsubscribe = onSessionRejected(rejected);

    setAuthToken('token-1');
    await expect(api.presets.list()).rejects.toMatchObject({ status: 401 });
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(rejected).toHaveBeenCalledTimes(1);

    // An explicit token (checking a different session) and no token at all never count as the session ending.
    await expect(api.auth.me('other-token')).rejects.toBeInstanceOf(ApiError);
    setAuthToken(null);
    await expect(api.presets.list()).rejects.toBeInstanceOf(ApiError);
    expect(new Headers(fetch.mock.calls[2][1].headers).has('authorization')).toBe(false);
    expect(rejected).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('marks plan refusals and keeps the backend message', async () => {
    vi.stubGlobal('fetch', respond(403, { detail: 'Session analytics is part of Voicematics Pro. Upgrade your plan to use it.' }));
    setAuthToken('token-1');
    const error = await api.sessions.list().catch((caught: unknown) => caught);
    expect(isPlanRequired(error)).toBe(true);
    expect((error as ApiError).message).toBe('Session analytics is part of Voicematics Pro. Upgrade your plan to use it.');
  });
});
