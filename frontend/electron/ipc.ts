/**
 * IPC contract shared by the main process, preload, and renderer.
 * Type-only on purpose: the sandboxed preload cannot require local modules at runtime.
 */

export type IpcInvokeChannel =
  | 'direct-paste:status'
  | 'direct-paste:type'
  | 'direct-paste:request-permission'
  | 'hotkeys:status'
  | 'hotkeys:update'
  | 'hotkeys:reset'
  | 'hotkeys:suspend';

export type IpcEventChannel = 'hotkeys:action' | 'hotkeys:changed';

/* Direct paste ------------------------------------------------------------ */

export type DirectPasteState = 'ready' | 'needs-permission' | 'limited' | 'unavailable';

export interface DirectPasteStatus {
  state: DirectPasteState;
  platform: string;
  /** Linux only; null elsewhere. */
  displayServer: 'wayland' | 'x11' | null;
  title: string;
  message: string;
  /** Ordered steps the user can follow to fix or work around the current state. */
  steps: string[];
  /** macOS: the UI can offer to open System Settings and show the OS prompt. */
  canRequestPermission: boolean;
}

export type DirectPasteMode = 'auto' | 'type' | 'paste';

export interface DirectPasteRequest {
  text: string;
  /**
   * `auto` types short text key by key and pastes the rest via the clipboard. `type` still pastes text
   * the platform cannot type reliably (non-ASCII anywhere; anything but letters and spaces on Linux).
   * The result's `method` reports what actually happened.
   */
  mode?: DirectPasteMode;
  /** Press Enter afterwards, e.g. to send a chat message. Off by default. */
  submit?: boolean;
}

export type DirectPasteFailure =
  | 'invalid-request'
  | 'permission-required'
  | 'unavailable'
  | 'omnivoice-focused'
  | 'failed';

export type DirectPasteResult =
  | { ok: true; method: 'type' | 'paste'; characters: number; submitted: boolean }
  | { ok: false; reason: DirectPasteFailure; message: string; status?: DirectPasteStatus };

/* Global hotkeys ---------------------------------------------------------- */

export type HotkeyAction = 'toggle-pitch-mode' | 'toggle-mute' | 'emergency-alert';

export interface HotkeyRegistration {
  action: HotkeyAction;
  label: string;
  accelerator: string;
  /** Platform-specific key names for display, e.g. ['Ctrl', 'Shift', 'P']. */
  keys: string[];
  /** False when another app already owns the shortcut. */
  registered: boolean;
  /** False where the OS accepts a registration without guaranteeing delivery (Wayland). */
  verified: boolean;
  /** True when the shortcut matches the built-in default. */
  isDefault: boolean;
  defaultAccelerator: string;
  /** Shell command that triggers this action in the running app, for binding keys manually. */
  triggerCommand: string | null;
}

export interface HotkeyStatus {
  registrations: HotkeyRegistration[];
  /** True while shortcuts are released so a new key combination can be recorded. */
  suspended: boolean;
  /** Platform caveat worth showing next to the list, if any. */
  note: string | null;
}

/** New accelerators by action, e.g. { 'toggle-mute': 'Control+Alt+M' }. */
export type HotkeyUpdateRequest = Partial<Record<HotkeyAction, string>>;

export type HotkeyUpdateResult =
  | { ok: true; status: HotkeyStatus }
  | { ok: false; status: HotkeyStatus; errors: Partial<Record<HotkeyAction, string>> };

/* Bridge exposed on window.omnivoice -------------------------------------- */

export interface OmniVoiceBridge {
  platform: string;
  directPaste: {
    getStatus(): Promise<DirectPasteStatus>;
    type(request: DirectPasteRequest): Promise<DirectPasteResult>;
    /** macOS: shows the system prompt and opens Accessibility settings. Returns the refreshed status. */
    requestPermission(): Promise<DirectPasteStatus>;
  };
  hotkeys: {
    getStatus(): Promise<HotkeyStatus>;
    /** Validates, registers, and saves new shortcuts. Nothing changes if any of them fails. */
    update(request: HotkeyUpdateRequest): Promise<HotkeyUpdateResult>;
    /** Restores the default shortcuts and deletes saved custom ones. */
    reset(): Promise<HotkeyStatus>;
    /** Releases (true) or restores (false) the shortcuts. Suspension ends on its own after 30 seconds. */
    suspend(suspended: boolean): Promise<HotkeyStatus>;
    /** Returns an unsubscribe function. */
    onAction(listener: (action: HotkeyAction) => void): () => void;
    /** Fires after shortcuts change, from any window. Returns an unsubscribe function. */
    onChange(listener: (status: HotkeyStatus) => void): () => void;
  };
  display: {
    /** Page zoom used for text size, 1 to 2. */
    setZoomFactor(factor: number): void;
    getZoomFactor(): number;
  };
}
