import type { OmniVoiceBridge } from '../../electron/ipc';

export type {
  AccountStorageStatus,
  DirectPasteResult,
  DirectPasteState,
  DirectPasteStatus,
  HotkeyAction,
  HotkeyRegistration,
  HotkeyStatus,
  HotkeyUpdateResult,
  OmniVoiceBridge,
  ShortcutResult,
} from '../../electron/ipc';

declare global {
  interface Window {
    /** Exposed by electron/preload.ts; undefined when running in a plain browser. */
    omnivoice?: OmniVoiceBridge;
  }
}
