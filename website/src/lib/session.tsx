'use client';

/**
 * The signed-in account, shared by the header, the checkout flow and the dashboard overlay.
 * The session token lives in localStorage and is re-checked against /api/auth/me on load.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AccountResponse, AuthCredentials, AuthSessionResponse, Subscription } from '@shared/types';
import { api, ApiError } from '@/lib/api';

const STORAGE_KEY = 'voicematics.session';

interface StoredSession {
  token: string;
  expiresAt: string;
}

export interface SessionState {
  ready: boolean;
  token: string | null;
  account: AccountResponse | null;
  subscription: Subscription | null;
  backendOnline: boolean | null;
  signUp: (credentials: AuthCredentials) => Promise<AuthSessionResponse>;
  signIn: (credentials: AuthCredentials) => Promise<AuthSessionResponse>;
  signOut: () => void;
  refresh: () => Promise<void>;
  applyAccount: (account: AccountResponse, subscription?: Subscription | null) => void;
}

const SessionContext = createContext<SessionState | null>(null);

function readStored(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredSession;
    if (!stored.token || new Date(stored.expiresAt).getTime() <= Date.now()) return null;
    return stored;
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the session lasts for this page only.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  const loadAccount = useCallback(async (sessionToken: string) => {
    const [me, current] = await Promise.all([api.auth.me(sessionToken), api.billing.subscription(sessionToken)]);
    setAccount(me);
    setSubscription(current);
  }, []);

  const accept = useCallback((session: AuthSessionResponse) => {
    writeStored({ token: session.token, expiresAt: session.expiresAt });
    setToken(session.token);
    setAccount({ user: session.user, license: session.license });
    setSubscription(null);
  }, []);

  const signOut = useCallback(() => {
    writeStored(null);
    setToken(null);
    setAccount(null);
    setSubscription(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.health();
        if (!cancelled) setBackendOnline(true);
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
      const stored = readStored();
      if (stored) {
        try {
          await loadAccount(stored.token);
          if (!cancelled) setToken(stored.token);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) writeStored(null);
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAccount]);

  const value = useMemo<SessionState>(
    () => ({
      ready,
      token,
      account,
      subscription,
      backendOnline,
      signUp: async (credentials) => {
        const session = await api.auth.signup(credentials);
        accept(session);
        return session;
      },
      signIn: async (credentials) => {
        const session = await api.auth.login(credentials);
        accept(session);
        void api.billing.subscription(session.token).then(setSubscription).catch(() => undefined);
        return session;
      },
      signOut,
      refresh: async () => {
        if (token) await loadAccount(token);
      },
      applyAccount: (next, current) => {
        setAccount(next);
        if (current !== undefined) setSubscription(current);
      },
    }),
    [ready, token, account, subscription, backendOnline, accept, signOut, loadAccount],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
