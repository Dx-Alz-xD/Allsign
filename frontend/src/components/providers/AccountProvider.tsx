'use client';

/**
 * The Voicematics account this app runs as.
 *
 * Signing in (or creating an account) registers this computer: the backend returns a device token that only works
 * on this machine, kept encrypted by the desktop shell. From then on the app starts signed in, trades the device
 * token for a fresh session token whenever the short-lived one runs out, and re-reads the plan every few minutes
 * and whenever the window regains focus, so an upgrade on the website shows up without restarting.
 *
 * Without the server, the last confirmed plan keeps working for OFFLINE_GRACE_MS. A paid licence is also bound to
 * one computer; on another computer the app shows the Free plan until the licence is moved there.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AccountResponse,
  AuthCredentials,
  AuthSessionResponse,
  Entitlements,
  Feature,
  LicenseVerifyResponse,
} from '@shared/types';
import { api, ApiError, onSessionRejected, setAuthToken } from '@/lib/api/client';
import { FREE_ENTITLEMENTS, hasFeature } from '@/lib/account/plans';
import {
  clearRecord,
  deviceLabel,
  hardwareId,
  loadRecord,
  saveRecord,
  type AccountRecord,
  type RecordStorage,
} from '@/lib/account/storage';

export type AccountStatus = 'loading' | 'signed-out' | 'signed-in';

const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_REFRESH_MS = 10 * 60 * 1000;
const FOCUS_REFRESH_AFTER_MS = 60 * 1000;
const OFFLINE_RETRY_MS = 30 * 1000;
/** Renew this long before the session token expires. */
const RENEW_BEFORE_EXPIRY_MS = 15 * 60 * 1000;

export interface AccountContextValue {
  status: AccountStatus;
  email: string | null;
  /** The current session token; null while signed out or offline. */
  token: string | null;
  account: AccountResponse | null;
  /** What this computer may use right now. */
  entitlements: Entitlements;
  /** What the plan grants, wherever its licence is bound. */
  planEntitlements: Entitlements;
  licence: LicenseVerifyResponse | null;
  /** A paid licence is bound to another computer, so this one runs on the Free plan. */
  licenceElsewhere: boolean;
  /** The server could not be reached; the last confirmed plan applies. */
  offline: boolean;
  refreshedAt: string | null;
  storage: RecordStorage | null;
  /** Why the person is looking at the sign-in screen, when it was not their choice. */
  notice: string | null;
  has: (feature: Feature | null) => boolean;
  signIn: (credentials: AuthCredentials, mode: 'login' | 'signup') => Promise<void>;
  /** `freeLicence` also unbinds the licence from this computer so another one can use it. */
  signOut: (options?: { freeLicence?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  moveLicenceHere: () => Promise<void>;
  /** Erases the account and everything saved with it, after checking the password. */
  deleteAccount: (password: string) => Promise<void>;
  /** Tries the saved account again after the server was unreachable. */
  retry: () => Promise<void>;
  canRetry: boolean;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccount must be used inside AccountProvider.');
  return context;
}

/** No answer from the server, as opposed to an answer that says no. */
function isUnreachable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

function accountOf(session: AuthSessionResponse): AccountResponse {
  return { user: session.user, license: session.license, entitlements: session.entitlements };
}

function stillCurrent(entitlements: Entitlements, now = Date.now()): Entitlements {
  // Offline, a monthly or annual plan still ends on time.
  return entitlements.expiresAt && Date.parse(entitlements.expiresAt) <= now ? FREE_ENTITLEMENTS : entitlements;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>('loading');
  const [record, setRecord] = useState<AccountRecord | null>(null);
  const [offline, setOffline] = useState(false);
  const [storage, setStorage] = useState<RecordStorage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const recordRef = useRef<AccountRecord | null>(null);
  const tokenRef = useRef<string | null>(null);
  const expiryTimerRef = useRef<number | null>(null);
  const renewingRef = useRef<Promise<void> | null>(null);
  const lastRefreshRef = useRef(0);

  const persist = useCallback(async (next: AccountRecord | null) => {
    recordRef.current = next;
    setRecord(next);
    if (next) setStorage(await saveRecord(next));
  }, []);

  const forget = useCallback(
    async (message: string | null) => {
      if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
      tokenRef.current = null;
      setAuthToken(null);
      setToken(null);
      recordRef.current = null;
      setRecord(null);
      setOffline(false);
      setNotice(message);
      setStatus('signed-out');
      await clearRecord();
    },
    [],
  );

  const verifyLicence = useCallback(
    async (account: AccountResponse) => {
      if (!account.license) return;
      try {
        const licence = await api.license.verify({
          email: account.user.email,
          licenseKey: account.license.key,
          hardwareId: await hardwareId(),
        });
        const current = recordRef.current;
        if (current) await persist({ ...current, licence });
      } catch {
        // Keep the last answer; the next refresh checks again.
      }
    },
    [persist],
  );

  // Declared before adopt, which schedules it; reached through a ref to avoid a dependency cycle.
  const renewRef = useRef<() => Promise<void>>(async () => undefined);

  const adopt = useCallback(
    async (session: AuthSessionResponse) => {
      tokenRef.current = session.token;
      setAuthToken(session.token);
      setToken(session.token);
      if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
      const renewIn = Math.max(60_000, Date.parse(session.expiresAt) - Date.now() - RENEW_BEFORE_EXPIRY_MS);
      expiryTimerRef.current = window.setTimeout(() => void renewRef.current(), renewIn);

      const account = accountOf(session);
      const current = recordRef.current;
      if (current) await persist({ ...current, email: account.user.email, account, refreshedAt: new Date().toISOString() });
      lastRefreshRef.current = Date.now();
      setOffline(false);
      setNotice(null);
      setStatus('signed-in');
      await verifyLicence(account);
    },
    [persist, verifyLicence],
  );

  const goOffline = useCallback(async () => {
    const current = recordRef.current;
    const confirmed = current?.refreshedAt ? Date.parse(current.refreshedAt) : 0;
    if (current?.account && Date.now() - confirmed < OFFLINE_GRACE_MS) {
      tokenRef.current = null;
      setAuthToken(null);
      setToken(null);
      setOffline(true);
      setStatus('signed-in');
      return;
    }
    // Keep the record so "Try again" works once the connection is back.
    setOffline(false);
    setStatus('signed-out');
    setNotice(
      current?.account
        ? 'Voicematics has not reached its server for over a week. Connect to the internet to confirm your account.'
        : 'Voicematics could not reach its server. Check your connection and try again.',
    );
  }, []);

  const renew = useCallback((): Promise<void> => {
    if (renewingRef.current) return renewingRef.current;
    const run = (async () => {
      const current = recordRef.current;
      if (!current) return;
      try {
        const session = await api.auth.devices.session({ deviceToken: current.deviceToken, hardwareId: await hardwareId() });
        await adopt(session);
      } catch (error) {
        if (isUnreachable(error)) await goOffline();
        else await forget('This computer was signed out of Voicematics. Sign in again to continue.');
      }
    })();
    renewingRef.current = run;
    void run.finally(() => {
      if (renewingRef.current === run) renewingRef.current = null;
    });
    return run;
  }, [adopt, forget, goOffline]);
  renewRef.current = renew;

  const refresh = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      await renew();
      return;
    }
    lastRefreshRef.current = Date.now();
    try {
      const account = await api.auth.me(token);
      const current = recordRef.current;
      if (current) await persist({ ...current, account, refreshedAt: new Date().toISOString() });
      setOffline(false);
      await verifyLicence(account);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await renew();
      else if (isUnreachable(error)) setOffline(true);
    }
  }, [persist, renew, verifyLicence]);

  // Start: resume the account saved on this computer.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadRecord();
      if (cancelled) return;
      if (!saved) {
        setStatus('signed-out');
        return;
      }
      recordRef.current = saved;
      setRecord(saved);
      await renew();
    })();
    return () => {
      cancelled = true;
    };
  }, [renew]);

  // A request that came back 401 means the session token stopped working: get a new one from the device token.
  useEffect(() => onSessionRejected(() => void renew()), [renew]);

  useEffect(() => {
    if (status !== 'signed-in') return;
    const timer = window.setInterval(() => void (offline ? renew() : refresh()), offline ? OFFLINE_RETRY_MS : PLAN_REFRESH_MS);
    const onFocus = () => {
      if (Date.now() - lastRefreshRef.current > FOCUS_REFRESH_AFTER_MS) void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [offline, refresh, renew, status]);

  useEffect(
    () => () => {
      if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
    },
    [],
  );

  const signIn = useCallback(
    async (credentials: AuthCredentials, mode: 'login' | 'signup') => {
      const session = mode === 'signup' ? await api.auth.signup(credentials) : await api.auth.login(credentials);
      const machine = await hardwareId();
      const device = await api.auth.devices.register({ hardwareId: machine, label: deviceLabel() }, session.token);
      const previous = recordRef.current;
      if (previous && previous.deviceToken !== device.deviceToken) {
        void api.auth.devices.revoke({ deviceToken: previous.deviceToken }).catch(() => undefined);
      }
      await persist({
        version: 1,
        email: session.user.email,
        deviceToken: device.deviceToken,
        account: accountOf(session),
        licence: null,
        refreshedAt: new Date().toISOString(),
      });
      await adopt(session);
    },
    [adopt, persist],
  );

  const signOut = useCallback(
    async ({ freeLicence = false }: { freeLicence?: boolean } = {}) => {
      // Freeing the licence needs the session, so it happens first and a failure stops the sign-out.
      if (freeLicence && tokenRef.current) await api.license.deactivate();
      const current = recordRef.current;
      if (current) await api.auth.devices.revoke({ deviceToken: current.deviceToken }).catch(() => undefined);
      await forget(null);
    },
    [forget],
  );

  const moveLicenceHere = useCallback(async () => {
    await api.license.deactivate();
    const account = recordRef.current?.account;
    if (account) await verifyLicence(account);
  }, [verifyLicence]);

  const deleteAccount = useCallback(
    async (password: string) => {
      await api.auth.deleteAccount({ password });
      await forget('Your Voicematics account and everything saved with it were deleted.');
    },
    [forget],
  );

  const retry = useCallback(async () => {
    setStatus('loading');
    await renew();
  }, [renew]);

  const value = useMemo<AccountContextValue>(() => {
    const account = record?.account ?? null;
    const planEntitlements = stillCurrent(account?.entitlements ?? FREE_ENTITLEMENTS);
    const licence = record?.licence ?? null;
    const licenceElsewhere = licence?.status === 'hardware_mismatch' && planEntitlements.tier !== 'free';
    const entitlements = licenceElsewhere ? FREE_ENTITLEMENTS : planEntitlements;
    return {
      status,
      email: record?.email ?? null,
      token,
      account,
      entitlements,
      planEntitlements,
      licence,
      licenceElsewhere,
      offline,
      refreshedAt: record?.refreshedAt ?? null,
      storage,
      notice,
      has: (feature) => hasFeature(entitlements, feature),
      signIn,
      signOut,
      refresh,
      moveLicenceHere,
      deleteAccount,
      retry,
      canRetry: status === 'signed-out' && record !== null,
    };
  }, [deleteAccount, moveLicenceHere, notice, offline, record, refresh, retry, signIn, signOut, status, storage, token]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
