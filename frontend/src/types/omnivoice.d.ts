import type { OmniVoiceBridge } from '../../electron/ipc';

export type {
  DirectPasteResult,
  DirectPasteState,
  DirectPasteStatus,
  HotkeyAction,
  HotkeyRegistration,
  HotkeyStatus,
  HotkeyUpdateResult,
  OmniVoiceBridge,
} from '../../electron/ipc';

declare global {
  interface Window {
    /** Exposed by electron/preload.ts; undefined when running in a plain browser. */
    omnivoice?: OmniVoiceBridge;
  }
}
