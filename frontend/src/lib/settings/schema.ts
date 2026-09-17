/**
 * User settings saved on this device. The pre-paint script in app/layout.tsx and electron/preload.ts
 * read `display` directly from storage, so keep that shape stable.
 */

export const SETTINGS_STORAGE_KEY = 'omnivoice:settings';
/** Every key Voicematics writes to browser storage starts with this, so export and erase can find them. */
export const STORAGE_PREFIX = 'omnivoice:';

export const TEXT_SCALE = { min: 100, max: 200, step: 10 } as const;
export const SYSTEM_DEFAULT_DEVICE = 'default';
/** Bump when the terms change materially so people are asked to acknowledge them again. */
export const TERMS_VERSION = '2026-09-17';

export interface DisplaySettings {
  /** null follows the operating system's contrast preference. */
  highContrast: boolean | null;
  /** Percent, 100 to 200 in steps of 10. */
  textScale: number;
}

export interface AudioSettings {
  inputDeviceId: string;
  inputLabel: string;
  outputDeviceId: string;
  outputLabel: string;
}

export interface NetworkSettings {
  stunUrls: string[];
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
}

export type RecognizerModel = 'tiny' | 'base' | 'small';

export interface SpeechSettings {
  /** ClearVoice also asks Gemini for a context-aware second answer. */
  geminiAnswer: boolean;
  /** The on-device Whisper model: bigger is more accurate and slower to load. */
  recognizerModel: RecognizerModel;
}

export interface LegalSettings {
  termsVersion: string | null;
  termsAcknowledgedAt: string | null;
}

export interface AppSettings {
  version: 1;
  display: DisplaySettings;
  audio: AudioSettings;
  network: NetworkSettings;
  speech: SpeechSettings;
  legal: LegalSettings;
}

export function defaultNetworkSettings(): NetworkSettings {
  return {
    stunUrls: (process.env.NEXT_PUBLIC_STUN_SERVER ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    turnUrl: '',
    turnUsername: '',
    turnCredential: '',
  };
}

export function defaultSettings(): AppSettings {
  return {
    version: 1,
    display: { highContrast: null, textScale: TEXT_SCALE.min },
    audio: {
      inputDeviceId: SYSTEM_DEFAULT_DEVICE,
      inputLabel: '',
      outputDeviceId: SYSTEM_DEFAULT_DEVICE,
      outputLabel: '',
    },
    network: defaultNetworkSettings(),
    speech: { geminiAnswer: true, recognizerModel: 'base' },
    legal: { termsVersion: null, termsAcknowledgedAt: null },
  };
}

export function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return TEXT_SCALE.min;
  const stepped = Math.round(value / TEXT_SCALE.step) * TEXT_SCALE.step;
  return Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, stepped));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const stringOr = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

/** Accepts anything read from storage and returns valid settings, keeping each field that checks out. */
export function parseSettings(input: unknown): AppSettings {
  const fallback = defaultSettings();
  if (!isRecord(input)) return fallback;

  const display = isRecord(input.display) ? input.display : {};
  const audio = isRecord(input.audio) ? input.audio : {};
  const network = isRecord(input.network) ? input.network : {};
  const speech = isRecord(input.speech) ? input.speech : {};
  const legal = isRecord(input.legal) ? input.legal : {};

  return {
    version: 1,
    display: {
      highContrast: typeof display.highContrast === 'boolean' ? display.highContrast : null,
      textScale: typeof display.textScale === 'number' ? clampTextScale(display.textScale) : fallback.display.textScale,
    },
    audio: {
      inputDeviceId: stringOr(audio.inputDeviceId, fallback.audio.inputDeviceId) || SYSTEM_DEFAULT_DEVICE,
      inputLabel: stringOr(audio.inputLabel, ''),
      outputDeviceId: stringOr(audio.outputDeviceId, fallback.audio.outputDeviceId) || SYSTEM_DEFAULT_DEVICE,
      outputLabel: stringOr(audio.outputLabel, ''),
    },
    network: {
      stunUrls: Array.isArray(network.stunUrls)
        ? network.stunUrls.filter((url): url is string => typeof url === 'string')
        : fallback.network.stunUrls,
      turnUrl: stringOr(network.turnUrl, ''),
      turnUsername: stringOr(network.turnUsername, ''),
      turnCredential: stringOr(network.turnCredential, ''),
    },
    speech: {
      geminiAnswer: typeof speech.geminiAnswer === 'boolean' ? speech.geminiAnswer : fallback.speech.geminiAnswer,
      recognizerModel: speech.recognizerModel === 'tiny' || speech.recognizerModel === 'small' ? speech.recognizerModel : 'base',
    },
    legal: {
      termsVersion: typeof legal.termsVersion === 'string' ? legal.termsVersion : null,
      termsAcknowledgedAt: typeof legal.termsAcknowledgedAt === 'string' ? legal.termsAcknowledgedAt : null,
    },
  };
}
