import {
  app,
  clipboard,
  ipcMain,
  shell,
  systemPreferences,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type NativeImage,
  type WebFrameMain,
} from 'electron';
import { canonicalAccelerator } from './accelerator';
import type {
  DirectPasteMode,
  DirectPasteRequest,
  DirectPasteResult,
  DirectPasteStatus,
  IpcInvokeChannel,
  ShortcutResult,
} from './ipc';

type NutJs = typeof import('@nut-tree-fork/nut-js');

const MAX_TEXT_LENGTH = 2000;
const AUTO_TYPE_MAX_LENGTH = 200;
/** nut.js defaults to 300 ms per key, far too slow for dictation. */
const KEY_DELAY_MS = 8;
/** Give the target app time to read the clipboard before the previous contents come back. */
const CLIPBOARD_RESTORE_DELAY_MS = 1000;
const MAC_ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

/* Native automation loading ----------------------------------------------- */

let nut: NutJs | null = null;
let nutLoadError: string | null = null;

/**
 * Loads nut.js on first use. On macOS its native layer shows the Accessibility prompt as soon as it
 * loads, so callers must only get here once the process is already trusted.
 */
function loadNut(): NutJs | null {
  if (nut || nutLoadError) return nut;
  try {
    const loaded: NutJs = require('@nut-tree-fork/nut-js');
    loaded.keyboard.config.autoDelayMs = KEY_DELAY_MS;
    loaded.providerRegistry.getKeyboard().setKeyboardDelay(KEY_DELAY_MS);
    nut = loaded;
  } catch (error) {
    nutLoadError = error instanceof Error ? error.message : String(error);
  }
  return nut;
}

/* Status and platform guidance -------------------------------------------- */

function linuxDisplayServer(): 'wayland' | 'x11' | null {
  if (process.platform !== 'linux') return null;
  return process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11';
}

function isMacTrusted(prompt: boolean): boolean {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(prompt);
}

export function getDirectPasteStatus(): DirectPasteStatus {
  const platform = process.platform;
  const displayServer = linuxDisplayServer();
  const base = { platform, displayServer, steps: [] as string[], canRequestPermission: false };
  const appName = app.isPackaged ? app.getName() : 'Electron (or the terminal you started OmniVoice OS from)';

  if (platform === 'darwin' && !isMacTrusted(false)) {
    return {
      ...base,
      state: 'needs-permission',
      title: 'Allow OmniVoice OS to type for you',
      message: 'macOS only lets apps type into other apps after you turn on Accessibility access.',
      steps: [
        'Select Open System Settings below.',
        `In Privacy & Security, open Accessibility and turn on ${appName}.`,
        'If it is already on, turn it off and on again.',
        'Quit and reopen OmniVoice OS so macOS applies the change.',
      ],
      canRequestPermission: true,
    };
  }

  if (!loadNut()) {
    return {
      ...base,
      state: 'unavailable',
      title: 'Direct paste could not start',
      message: `The keyboard automation library failed to load: ${nutLoadError ?? 'unknown error'}`,
      steps:
        platform === 'linux'
          ? [
              'Install the X11 test extension library: libxtst on Arch, libxtst6 on Debian or Ubuntu.',
              'Restart OmniVoice OS.',
            ]
          : ['Reinstall OmniVoice OS, then restart it.'],
    };
  }

  if (platform === 'linux' && displayServer === 'wayland') {
    return {
      ...base,
      state: 'limited',
      title: 'Typing only reaches apps running through XWayland',
      message: 'Wayland blocks simulated typing into native Wayland apps, so some windows will not receive text.',
      steps: [
        'Slack, Discord, and other Electron or Chromium apps: start them with --ozone-platform=x11.',
        'Zoom: start it with QT_QPA_PLATFORM=xcb.',
        'To type into every app, sign in to an X11 session instead of Wayland.',
      ],
    };
  }

  if (platform === 'linux' && !process.env.DISPLAY) {
    return {
      ...base,
      state: 'unavailable',
      title: 'No X11 display found',
      message: 'Direct paste needs an X11 or XWayland display, and the DISPLAY variable is not set.',
      steps: ['Start OmniVoice OS from a graphical session.'],
    };
  }

  return {
    ...base,
    state: 'ready',
    title: 'Ready to type into the active app',
    message:
      platform === 'win32'
        ? 'Apps running as administrator only accept typing when OmniVoice OS also runs as administrator.'
        : 'Text goes to whichever app has keyboard focus.',
  };
}

/* Typing ------------------------------------------------------------------ */

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage;
}

function snapshotClipboard(): ClipboardSnapshot {
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: clipboard.readImage(),
  };
}

function restoreClipboard(snapshot: ClipboardSnapshot, pastedText: string) {
  // Leave the clipboard alone if the user copied something new in the meantime.
  if (clipboard.readText() !== pastedText) return;
  clipboard.write({
    text: snapshot.text,
    html: snapshot.html || undefined,
    rtf: snapshot.rtf || undefined,
    image: snapshot.image.isEmpty() ? undefined : snapshot.image,
  });
  if (!snapshot.text && !snapshot.html && !snapshot.rtf && snapshot.image.isEmpty()) clipboard.clear();
}

/** Collapses newlines, tabs, and other control characters so text never triggers sends or focus changes. */
function sanitize(text: string): string {
  return text.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * libnut's X11 backend sends each character's base keycode and only adds Shift for letters, so
 * symbols like ! or ? arrive as 1 or / (and digits break on non-US layouts). Linux therefore types
 * letters and spaces only; Windows and macOS type any printable ASCII.
 */
function canTypeKeyByKey(text: string): boolean {
  return process.platform === 'linux' ? /^[A-Za-z ]*$/.test(text) : /^[\x20-\x7E]*$/.test(text);
}

function resolveMethod(mode: DirectPasteMode, text: string): 'type' | 'paste' {
  if (mode === 'paste' || !canTypeKeyByKey(text)) return 'paste';
  return mode === 'type' || text.length <= AUTO_TYPE_MAX_LENGTH ? 'type' : 'paste';
}

function parseRequest(input: unknown): DirectPasteRequest | null {
  if (typeof input !== 'object' || input === null) return null;
  const { text, mode = 'auto', submit = false } = input as Record<string, unknown>;
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) return null;
  if (mode !== 'auto' && mode !== 'type' && mode !== 'paste') return null;
  if (typeof submit !== 'boolean') return null;
  return { text, mode, submit };
}

export interface DirectPasteContext {
  /** OmniVoice's own window, used to avoid typing into ourselves. */
  getWindow: () => BrowserWindow | null;
}

async function typeIntoFocusedApp(input: unknown, context: DirectPasteContext): Promise<DirectPasteResult> {
  const request = parseRequest(input);
  const text = request ? sanitize(request.text) : '';
  if (!request || text.length === 0) {
    return { ok: false, reason: 'invalid-request', message: `Send between 1 and ${MAX_TEXT_LENGTH} characters of text.` };
  }

  const status = getDirectPasteStatus();
  if (status.state === 'needs-permission') {
    return { ok: false, reason: 'permission-required', message: status.message, status };
  }
  const automation = status.state === 'unavailable' ? null : loadNut();
  if (!automation) {
    return { ok: false, reason: 'unavailable', message: status.message, status };
  }

  if (context.getWindow()?.isFocused()) {
    return {
      ok: false,
      reason: 'omnivoice-focused',
      message: 'OmniVoice OS is the active window, so nothing was typed. Switch to the app you want to type into first.',
    };
  }

  const { keyboard, Key } = automation;
  const method = resolveMethod(request.mode ?? 'auto', text);
  const pasteModifier = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl;

  try {
    if (method === 'type') {
      await keyboard.type(text);
    } else {
      const snapshot = snapshotClipboard();
      clipboard.writeText(text);
      try {
        await keyboard.pressKey(pasteModifier, Key.V);
      } finally {
        // Never leave a modifier held down in someone else's app.
        await keyboard.releaseKey(pasteModifier, Key.V);
      }
      setTimeout(() => restoreClipboard(snapshot, text), CLIPBOARD_RESTORE_DELAY_MS);
    }

    if (request.submit) {
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    }

    return { ok: true, method, characters: text.length, submitted: Boolean(request.submit) };
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      message: `Typing failed: ${error instanceof Error ? error.message : String(error)}`,
      status,
    };
  }
}

/* Shortcuts ----------------------------------------------------------------- */

const MAX_SHORTCUT_KEYS = 4;

/** Electron accelerator token -> nut.js Key name. Letters and digits map directly. */
const SHORTCUT_KEY_NAMES: Record<string, string> = {
  Command: 'LeftCmd',
  Control: 'LeftControl',
  Alt: 'LeftAlt',
  AltGr: 'RightAlt',
  Shift: 'LeftShift',
  Super: 'LeftSuper',
  Enter: 'Enter',
  Space: 'Space',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Plus: 'Add',
  VolumeUp: 'AudioVolUp',
  VolumeDown: 'AudioVolDown',
  VolumeMute: 'AudioMute',
  MediaPlayPause: 'AudioPlay',
  MediaNextTrack: 'AudioNext',
  MediaPreviousTrack: 'AudioPrev',
  MediaStop: 'AudioStop',
  PrintScreen: 'Print',
};

function shortcutKeys(accelerator: string, keys: Record<string, number>): number[] | null {
  const canonical = canonicalAccelerator(accelerator, process.platform);
  if (!canonical) return null;
  const tokens = canonical.split('+');
  if (tokens.length > MAX_SHORTCUT_KEYS) return null;
  const resolved: number[] = [];
  for (const token of tokens) {
    let name = SHORTCUT_KEY_NAMES[token];
    if (!name && /^[A-Z]$/.test(token)) name = token;
    if (!name && /^[0-9]$/.test(token)) name = `Num${token}`;
    if (!name && /^F([1-9]|1[0-9]|2[0-4])$/.test(token)) name = token;
    const key = name ? keys[name] : undefined;
    if (key === undefined) return null;
    resolved.push(key);
  }
  return resolved;
}

async function pressShortcut(input: unknown, context: DirectPasteContext): Promise<ShortcutResult> {
  if (typeof input !== 'string' || input.length === 0 || input.length > 64) {
    return { ok: false, reason: 'invalid-request', message: 'Send an accelerator such as Control+Shift+M.' };
  }
  const status = getDirectPasteStatus();
  if (status.state === 'needs-permission') return { ok: false, reason: 'permission-required', message: status.message, status };
  const automation = status.state === 'unavailable' ? null : loadNut();
  if (!automation) return { ok: false, reason: 'unavailable', message: status.message, status };
  if (context.getWindow()?.isFocused()) {
    return { ok: false, reason: 'omnivoice-focused', message: 'OmniVoice OS is the active window, so the shortcut was not sent.' };
  }

  const keys = shortcutKeys(input, automation.Key as unknown as Record<string, number>);
  if (!keys) return { ok: false, reason: 'invalid-request', message: `"${input}" is not a shortcut this platform can press.` };

  const { keyboard } = automation;
  try {
    try {
      await keyboard.pressKey(...keys);
    } finally {
      await keyboard.releaseKey(...keys);
    }
    return { ok: true, accelerator: input };
  } catch (error) {
    return { ok: false, reason: 'failed', message: `Shortcut failed: ${error instanceof Error ? error.message : String(error)}`, status };
  }
}

/* IPC --------------------------------------------------------------------- */

export interface DirectPasteIpcOptions extends DirectPasteContext {
  isTrustedSender: (frame: WebFrameMain | null) => boolean;
}

const CHANNELS = {
  status: 'direct-paste:status',
  type: 'direct-paste:type',
  shortcut: 'direct-paste:shortcut',
  requestPermission: 'direct-paste:request-permission',
} as const satisfies Record<string, IpcInvokeChannel>;

/** Registers the direct paste IPC handlers. Returns a function that removes them. */
export function registerDirectPasteIpc(options: DirectPasteIpcOptions): () => void {
  const guard = (event: IpcMainInvokeEvent) => {
    if (!options.isTrustedSender(event.senderFrame)) throw new Error('Blocked direct paste request from an untrusted page.');
  };

  // Requests are serialized so two dictations can never interleave their keystrokes.
  let queue: Promise<unknown> = Promise.resolve();

  ipcMain.handle(CHANNELS.status, (event) => {
    guard(event);
    return getDirectPasteStatus();
  });

  ipcMain.handle(CHANNELS.type, (event, request: unknown) => {
    guard(event);
    const result = queue.then(() => typeIntoFocusedApp(request, options));
    queue = result.catch(() => undefined);
    return result;
  });

  ipcMain.handle(CHANNELS.shortcut, (event, accelerator: unknown) => {
    guard(event);
    const result = queue.then(() => pressShortcut(accelerator, options));
    queue = result.catch(() => undefined);
    return result;
  });

  ipcMain.handle(CHANNELS.requestPermission, async (event) => {
    guard(event);
    if (process.platform === 'darwin' && !isMacTrusted(false)) {
      isMacTrusted(true);
      await shell.openExternal(MAC_ACCESSIBILITY_SETTINGS_URL);
    }
    return getDirectPasteStatus();
  });

  return () => Object.values(CHANNELS).forEach((channel) => ipcMain.removeHandler(channel));
}

export const directPasteForTesting = { typeIntoFocusedApp, sanitize, resolveMethod, parseRequest, shortcutKeys };
