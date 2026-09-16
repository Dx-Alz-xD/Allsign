import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';
import type {
  DirectPasteResult,
  DirectPasteStatus,
  HotkeyAction,
  HotkeyStatus,
  HotkeyUpdateResult,
  IpcEventChannel,
  IpcInvokeChannel,
  OmniVoiceBridge,
} from './ipc';

// Sandboxed preloads can only require 'electron', so channel names are checked against the
// contract at compile time instead of being imported at runtime.
const invoke = <T>(channel: IpcInvokeChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;
const HOTKEY_ACTIONS: readonly HotkeyAction[] = ['toggle-pitch-mode', 'toggle-mute', 'emergency-alert'];
const MIN_ZOOM = 1;
const MAX_ZOOM = 2;

function subscribe<T>(channel: IpcEventChannel, accept: (payload: unknown) => payload is T, listener: (payload: T) => void) {
  const handler = (_event: IpcRendererEvent, payload: unknown) => {
    if (accept(payload)) listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

// Apply the saved text size before the first paint so the window never flashes at 100%.
// Mirrors the settings shape in src/lib/settings/schema.ts.
try {
  const saved: unknown = JSON.parse(window.localStorage.getItem('omnivoice:settings') ?? 'null');
  const scale = Number((saved as { display?: { textScale?: unknown } } | null)?.display?.textScale);
  if (scale >= 100 && scale <= 200) webFrame.setZoomFactor(scale / 100);
} catch {
  // Storage unavailable or corrupt: keep the default zoom.
}

const bridge: OmniVoiceBridge = {
  platform: process.platform,
  directPaste: {
    getStatus: () => invoke<DirectPasteStatus>('direct-paste:status'),
    type: (request) => invoke<DirectPasteResult>('direct-paste:type', request),
    requestPermission: () => invoke<DirectPasteStatus>('direct-paste:request-permission'),
  },
  hotkeys: {
    getStatus: () => invoke<HotkeyStatus>('hotkeys:status'),
    update: (request) => invoke<HotkeyUpdateResult>('hotkeys:update', request),
    reset: () => invoke<HotkeyStatus>('hotkeys:reset'),
    suspend: (suspended) => invoke<HotkeyStatus>('hotkeys:suspend', suspended),
    onAction: (listener) =>
      subscribe('hotkeys:action', (value): value is HotkeyAction => HOTKEY_ACTIONS.includes(value as HotkeyAction), listener),
    onChange: (listener) =>
      subscribe(
        'hotkeys:changed',
        (value): value is HotkeyStatus => typeof value === 'object' && value !== null && 'registrations' in value,
        listener,
      ),
  },
  display: {
    setZoomFactor: (factor) => {
      if (Number.isFinite(factor)) webFrame.setZoomFactor(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor)));
    },
    getZoomFactor: () => webFrame.getZoomFactor(),
  },
};

contextBridge.exposeInMainWorld('omnivoice', bridge);
