import { globalShortcut } from 'electron';
import { canonicalAccelerator, displayAcceleratorKeys } from './accelerator';
import type { HotkeyAction, HotkeyRegistration, HotkeyStatus } from './ipc';

export interface HotkeyBinding {
  action: HotkeyAction;
  label: string;
  accelerator: string;
}

export const DEFAULT_HOTKEYS: readonly HotkeyBinding[] = [
  { action: 'toggle-pitch-mode', label: 'Pitch Mode', accelerator: 'CommandOrControl+Shift+P' },
  { action: 'toggle-mute', label: 'Mute or unmute', accelerator: 'CommandOrControl+Shift+M' },
  { action: 'emergency-alert', label: 'Emergency AAC alert', accelerator: 'CommandOrControl+Shift+A' },
];

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = DEFAULT_HOTKEYS.map((binding) => binding.action);

/** `--hotkey=<action>` on a second launch triggers the action in the running instance. */
export const HOTKEY_ARG_PREFIX = '--hotkey=';

export function hotkeyActionFromArgv(argv: readonly string[]): HotkeyAction | null {
  const value = argv.find((arg) => arg.startsWith(HOTKEY_ARG_PREFIX))?.slice(HOTKEY_ARG_PREFIX.length);
  return HOTKEY_ACTIONS.find((action) => action === value) ?? null;
}

export function bindingsWithOverrides(overrides: Partial<Record<HotkeyAction, string>>): HotkeyBinding[] {
  return DEFAULT_HOTKEYS.map((binding) => ({ ...binding, accelerator: overrides[binding.action] ?? binding.accelerator }));
}

/** Holding a shortcut auto-repeats on most systems; ignore repeats so toggles don't flip back and forth. */
const REPEAT_GUARD_MS = 500;

function isWaylandSession(): boolean {
  return process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY));
}

function sameShortcut(a: string, b: string): boolean {
  return canonicalAccelerator(a, process.platform) === canonicalAccelerator(b, process.platform);
}

export interface GlobalHotkeyManagerOptions {
  bindings?: readonly HotkeyBinding[];
  /** Builds the shell command that triggers an action in the running app, shown as a fallback. */
  triggerCommand?: (action: HotkeyAction) => string;
}

export class GlobalHotkeyManager {
  private bindings: HotkeyBinding[];
  private registrations: HotkeyRegistration[] = [];
  private suspended = false;
  private readonly lastFiredAt = new Map<HotkeyAction, number>();

  constructor(
    private readonly onAction: (action: HotkeyAction) => void,
    private readonly options: GlobalHotkeyManagerOptions = {},
  ) {
    this.bindings = (options.bindings ?? DEFAULT_HOTKEYS).map((binding) => ({ ...binding }));
  }

  getBindings(): readonly HotkeyBinding[] {
    return this.bindings;
  }

  /** Registers every binding system-wide. A binding fails when another app already owns the shortcut. */
  registerAll(): readonly HotkeyRegistration[] {
    this.releaseShortcuts();
    this.suspended = false;
    // Wayland accepts the registration without confirming the compositor will ever deliver it.
    const verified = !isWaylandSession();
    this.registrations = this.bindings.map((binding) => {
      let registered = false;
      try {
        registered = globalShortcut.register(binding.accelerator, () => this.trigger(binding.action));
      } catch {
        registered = false;
      }
      const defaultAccelerator =
        DEFAULT_HOTKEYS.find((item) => item.action === binding.action)?.accelerator ?? binding.accelerator;
      return {
        ...binding,
        keys: displayAcceleratorKeys(binding.accelerator, process.platform),
        registered,
        verified,
        isDefault: sameShortcut(binding.accelerator, defaultAccelerator),
        defaultAccelerator,
        triggerCommand: this.options.triggerCommand?.(binding.action) ?? null,
      };
    });
    return this.registrations;
  }

  /**
   * Swaps in new bindings. If any shortcut that changed cannot be registered, the previous bindings are
   * restored and the failing actions are returned.
   */
  applyBindings(next: readonly HotkeyBinding[]): HotkeyAction[] {
    const previous = this.bindings;
    this.bindings = next.map((binding) => ({ ...binding }));
    const failed = this.registerAll()
      .filter((registration) => {
        const before = previous.find((binding) => binding.action === registration.action);
        return !registration.registered && (!before || !sameShortcut(before.accelerator, registration.accelerator));
      })
      .map((registration) => registration.action);

    if (failed.length > 0) {
      this.bindings = previous;
      this.registerAll();
    }
    return failed;
  }

  /** Temporarily releases the shortcuts, e.g. while the user records a new key combination. */
  suspend(): void {
    this.releaseShortcuts();
    this.suspended = true;
  }

  resume(): void {
    if (this.suspended) this.registerAll();
  }

  unregisterAll(): void {
    this.releaseShortcuts();
    this.registrations = [];
  }

  getStatus(): HotkeyStatus {
    return {
      registrations: this.registrations.map((registration) => ({ ...registration, keys: [...registration.keys] })),
      suspended: this.suspended,
      note: isWaylandSession()
        ? 'Wayland desktops decide whether apps may use global shortcuts, and some never deliver them. If a shortcut does not respond, bind the keys in your desktop or compositor settings to run the command shown for it.'
        : null,
    };
  }

  /** Runs an action through the same repeat guard as a key press. */
  trigger(action: HotkeyAction): void {
    const now = Date.now();
    if (now - (this.lastFiredAt.get(action) ?? 0) < REPEAT_GUARD_MS) return;
    this.lastFiredAt.set(action, now);
    this.onAction(action);
  }

  private releaseShortcuts(): void {
    for (const registration of this.registrations) {
      if (registration.registered) globalShortcut.unregister(registration.accelerator);
    }
  }
}
