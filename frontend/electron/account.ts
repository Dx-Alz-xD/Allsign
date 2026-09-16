import { app, ipcMain, safeStorage, type IpcMainInvokeEvent, type WebFrameMain } from 'electron';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AccountStorageStatus, IpcInvokeChannel } from './ipc';

/**
 * The signed-in Voicematics account on this computer: an opaque record the renderer serialises (email, device
 * token, the last account answer), kept encrypted with the OS keychain through safeStorage, and a stable machine
 * id for licence binding. The raw machine id never leaves this process; the renderer only sees a SHA-256 of it.
 */

const CHANNELS = {
  hardwareId: 'account:hardware-id',
  load: 'account:load',
  save: 'account:save',
  clear: 'account:clear',
  storage: 'account:storage',
} as const satisfies Record<string, IpcInvokeChannel>;

const MAX_RECORD_CHARS = 64_000;
const HARDWARE_ID_SALT = 'voicematics-desktop:';

const recordPath = () => path.join(app.getPath('userData'), 'account.bin');
const fallbackIdPath = () => path.join(app.getPath('userData'), 'machine-id');

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout)));
  });
}

async function readFirst(files: string[]): Promise<string> {
  for (const file of files) {
    const value = await fs.readFile(file, 'utf8').then((text) => text.trim(), () => '');
    if (value) return value;
  }
  return '';
}

async function platformMachineId(): Promise<string> {
  switch (process.platform) {
    case 'linux':
      return readFirst(['/etc/machine-id', '/var/lib/dbus/machine-id']);
    case 'darwin':
      return /"IOPlatformUUID" = "([^"]+)"/.exec(await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))?.[1] ?? '';
    case 'win32':
      return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']))?.[1] ?? '';
    default:
      return '';
  }
}

/** A machine without a readable id gets a random one, kept in the app's data folder. */
async function fallbackMachineId(): Promise<string> {
  const existing = await readFirst([fallbackIdPath()]);
  if (existing) return existing;
  const created = randomUUID();
  await fs.mkdir(path.dirname(fallbackIdPath()), { recursive: true });
  await fs.writeFile(fallbackIdPath(), created, { mode: 0o600 });
  return created;
}

let hardwareIdPromise: Promise<string> | null = null;

function hardwareId(): Promise<string> {
  hardwareIdPromise ??= (async () => {
    const raw = (await platformMachineId()) || (await fallbackMachineId());
    return createHash('sha256').update(HARDWARE_ID_SALT + raw).digest('hex');
  })();
  return hardwareIdPromise;
}

async function storageStatus(): Promise<AccountStorageStatus> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return 'memory-only';
  // Without a keyring on Linux, safeStorage "encrypts" with a fixed password: the record stays owner-readable only.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return 'file-only';
  return 'keychain';
}

async function load(): Promise<string | null> {
  if ((await storageStatus()) === 'memory-only') return null;
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(await fs.readFile(recordPath()));
    if (shouldReEncrypt) await save(result);
    return result;
  } catch {
    // Missing, or written under a keychain entry that no longer exists: the person signs in again.
    return null;
  }
}

async function save(record: string): Promise<AccountStorageStatus> {
  const status = await storageStatus();
  if (status === 'memory-only') return status;
  const file = recordPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, await safeStorage.encryptStringAsync(record), { mode: 0o600 });
  await fs.rename(temporary, file);
  return status;
}

export interface AccountIpcOptions {
  isTrustedSender: (frame: WebFrameMain | null) => boolean;
}

export function registerAccountIpc({ isTrustedSender }: AccountIpcOptions): () => void {
  const guard = (event: IpcMainInvokeEvent) => {
    if (!isTrustedSender(event.senderFrame)) throw new Error('Blocked account request from an untrusted page.');
  };

  ipcMain.handle(CHANNELS.hardwareId, (event) => {
    guard(event);
    return hardwareId();
  });
  ipcMain.handle(CHANNELS.load, (event) => {
    guard(event);
    return load();
  });
  ipcMain.handle(CHANNELS.save, (event, record: unknown) => {
    guard(event);
    if (typeof record !== 'string' || record.length > MAX_RECORD_CHARS) throw new Error('Invalid account record.');
    return save(record);
  });
  ipcMain.handle(CHANNELS.clear, async (event) => {
    guard(event);
    await fs.rm(recordPath(), { force: true });
  });
  ipcMain.handle(CHANNELS.storage, (event) => {
    guard(event);
    return storageStatus();
  });

  return () => Object.values(CHANNELS).forEach((channel) => ipcMain.removeHandler(channel));
}
