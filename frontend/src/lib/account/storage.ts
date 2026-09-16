import type { AccountResponse, LicenseVerifyResponse } from '@shared/types';
import type { AccountStorageStatus } from '@/types/omnivoice';

/**
 * The account remembered on this computer. In the desktop app it goes through the main process, encrypted with
 * the OS keychain; in a plain browser (npm run dev without Electron) it falls back to localStorage.
 * The password is never kept: the device token stands in for it and only works on this machine.
 */
export interface AccountRecord {
  version: 1;
  email: string;
  deviceToken: string;
  /** The last account answer and licence check, so the plan still applies offline for a while. */
  account: AccountResponse | null;
  licence: LicenseVerifyResponse | null;
  /** ISO time the backend last confirmed the account. */
  refreshedAt: string | null;
}

export type RecordStorage = AccountStorageStatus | 'browser';

const RECORD_KEY = 'omnivoice:account';
const BROWSER_ID_KEY = 'omnivoice:browser-id';

export function parseRecord(raw: string | null): AccountRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AccountRecord> | null;
    if (!value || value.version !== 1 || typeof value.email !== 'string' || typeof value.deviceToken !== 'string') return null;
    return {
      version: 1,
      email: value.email,
      deviceToken: value.deviceToken,
      account: value.account && typeof value.account === 'object' ? value.account : null,
      licence: value.licence && typeof value.licence === 'object' ? value.licence : null,
      refreshedAt: typeof value.refreshedAt === 'string' ? value.refreshedAt : null,
    };
  } catch {
    return null;
  }
}

export async function loadRecord(): Promise<AccountRecord | null> {
  const bridge = window.omnivoice?.account;
  if (bridge) return parseRecord(await bridge.load().catch(() => null));
  try {
    return parseRecord(window.localStorage.getItem(RECORD_KEY));
  } catch {
    return null;
  }
}

export async function saveRecord(record: AccountRecord): Promise<RecordStorage> {
  const serialised = JSON.stringify(record);
  const bridge = window.omnivoice?.account;
  if (bridge) return bridge.save(serialised).catch((): RecordStorage => 'memory-only');
  try {
    window.localStorage.setItem(RECORD_KEY, serialised);
    return 'browser';
  } catch {
    return 'memory-only';
  }
}

export async function clearRecord(): Promise<void> {
  const bridge = window.omnivoice?.account;
  if (bridge) {
    await bridge.clear().catch(() => undefined);
    return;
  }
  try {
    window.localStorage.removeItem(RECORD_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The id the licence is bound to: a hash of the machine id in the desktop app, a random id per browser otherwise. */
export async function hardwareId(): Promise<string> {
  const bridge = window.omnivoice?.account;
  if (bridge) return bridge.getHardwareId();
  try {
    const stored = window.localStorage.getItem(BROWSER_ID_KEY);
    if (stored && stored.length >= 8) return stored;
    const created = `browser-${crypto.randomUUID()}`;
    window.localStorage.setItem(BROWSER_ID_KEY, created);
    return created;
  } catch {
    return `browser-${crypto.randomUUID()}`;
  }
}

export function deviceLabel(): string {
  const platform = window.omnivoice?.platform;
  const names: Record<string, string> = { linux: 'Linux', darwin: 'Mac', win32: 'Windows' };
  return platform ? `Voicematics on ${names[platform] ?? platform}` : 'Voicematics in a browser';
}
