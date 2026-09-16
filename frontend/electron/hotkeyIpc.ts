import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebFrameMain } from 'electron';
import { canonicalAccelerator, checkAccelerator, displayAcceleratorKeys } from './accelerator';
import { DEFAULT_HOTKEYS, type GlobalHotkeyManager } from './GlobalHotkeyManager';
import { clearHotkeyOverrides, saveHotkeyOverrides, type HotkeyOverrides } from './hotkeyStore';
import type { HotkeyAction, HotkeyStatus, HotkeyUpdateResult, IpcEventChannel, IpcInvokeChannel } from './ipc';

/** If the renderer never ends a recording (crash, closed window), shortcuts come back on their own. */
const SUSPEND_TIMEOUT_MS = 30_000;

const CHANNELS = {
  status: 'hotkeys:status',
  update: 'hotkeys:update',
  reset: 'hotkeys:reset',
  suspend: 'hotkeys:suspend',
} as const satisfies Record<string, IpcInvokeChannel>;

const CHANGED_EVENT: IpcEventChannel = 'hotkeys:changed';

export interface HotkeyIpcOptions {
  manager: GlobalHotkeyManager;
  isTrustedSender: (frame: WebFrameMain | null) => boolean;
}

function broadcast(status: HotkeyStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANGED_EVENT, status);
  }
}

function keysLabel(accelerator: string): string {
  return displayAcceleratorKeys(accelerator, process.platform).join('+');
}

function updateBindings(manager: GlobalHotkeyManager, request: unknown): HotkeyUpdateResult {
  const errors: Partial<Record<HotkeyAction, string>> = {};
  const next = manager.getBindings().map((binding) => ({ ...binding }));
  const changed = new Set<HotkeyAction>();

  if (typeof request !== 'object' || request === null) {
    manager.resume();
    return { ok: false, status: manager.getStatus(), errors: {} };
  }

  for (const [action, accelerator] of Object.entries(request as Record<string, unknown>)) {
    const binding = next.find((item) => item.action === action);
    if (!binding || typeof accelerator !== 'string') continue;
    const check = checkAccelerator(accelerator, process.platform);
    if (!check.ok) {
      errors[binding.action] = check.message;
      continue;
    }
    binding.accelerator = accelerator;
    changed.add(binding.action);
  }

  for (const action of changed) {
    const binding = next.find((item) => item.action === action);
    const clash = next.find(
      (other) =>
        binding &&
        other.action !== action &&
        canonicalAccelerator(other.accelerator, process.platform) === canonicalAccelerator(binding.accelerator, process.platform),
    );
    if (binding && clash) errors[action] = `${keysLabel(binding.accelerator)} is already used for ${clash.label}.`;
  }

  if (Object.keys(errors).length > 0) {
    manager.resume();
    return { ok: false, status: manager.getStatus(), errors };
  }

  const failed = manager.applyBindings(next);
  if (failed.length > 0) {
    for (const action of failed) {
      const binding = next.find((item) => item.action === action);
      if (binding) errors[action] = `${keysLabel(binding.accelerator)} is already used by another app.`;
    }
    return { ok: false, status: manager.getStatus(), errors };
  }

  const overrides: HotkeyOverrides = {};
  for (const binding of manager.getBindings()) {
    const fallback = DEFAULT_HOTKEYS.find((item) => item.action === binding.action);
    if (fallback && canonicalAccelerator(binding.accelerator, process.platform) !== canonicalAccelerator(fallback.accelerator, process.platform)) {
      overrides[binding.action] = binding.accelerator;
    }
  }
  if (Object.keys(overrides).length > 0) saveHotkeyOverrides(overrides);
  else clearHotkeyOverrides();

  const status = manager.getStatus();
  broadcast(status);
  return { ok: true, status };
}

/** Registers the hotkey IPC handlers. Returns a function that removes them. */
export function registerHotkeyIpc({ manager, isTrustedSender }: HotkeyIpcOptions): () => void {
  let resumeTimer: NodeJS.Timeout | null = null;
  const clearResumeTimer = () => {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = null;
  };

  const guard = (event: IpcMainInvokeEvent) => {
    if (!isTrustedSender(event.senderFrame)) throw new Error('Blocked hotkey request from an untrusted page.');
  };

  ipcMain.handle(CHANNELS.status, (event) => {
    guard(event);
    return manager.getStatus();
  });

  ipcMain.handle(CHANNELS.update, (event, request: unknown) => {
    guard(event);
    clearResumeTimer();
    return updateBindings(manager, request);
  });

  ipcMain.handle(CHANNELS.reset, (event) => {
    guard(event);
    clearResumeTimer();
    clearHotkeyOverrides();
    manager.applyBindings(DEFAULT_HOTKEYS);
    const status = manager.getStatus();
    broadcast(status);
    return status;
  });

  ipcMain.handle(CHANNELS.suspend, (event, suspended: unknown) => {
    guard(event);
    clearResumeTimer();
    if (suspended === true) {
      manager.suspend();
      resumeTimer = setTimeout(() => {
        manager.resume();
        broadcast(manager.getStatus());
      }, SUSPEND_TIMEOUT_MS);
    } else {
      manager.resume();
    }
    return manager.getStatus();
  });

  return () => {
    clearResumeTimer();
    Object.values(CHANNELS).forEach((channel) => ipcMain.removeHandler(channel));
  };
}
