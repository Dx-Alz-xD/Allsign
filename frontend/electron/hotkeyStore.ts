import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { checkAccelerator } from './accelerator';
import type { HotkeyAction } from './ipc';

export type HotkeyOverrides = Partial<Record<HotkeyAction, string>>;

const overridesPath = () => path.join(app.getPath('userData'), 'hotkeys.json');

/** Reads custom shortcuts saved by the user, dropping anything unknown or invalid. */
export function loadHotkeyOverrides(actions: readonly HotkeyAction[]): HotkeyOverrides {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(overridesPath(), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return {};
    const overrides: HotkeyOverrides = {};
    for (const action of actions) {
      const accelerator = (raw as Record<string, unknown>)[action];
      if (typeof accelerator === 'string' && checkAccelerator(accelerator, process.platform).ok) {
        overrides[action] = accelerator;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function saveHotkeyOverrides(overrides: HotkeyOverrides): void {
  const file = overridesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(overrides, null, 2));
  fs.renameSync(temporary, file);
}

export function clearHotkeyOverrides(): void {
  fs.rmSync(overridesPath(), { force: true });
}
