import { SETTINGS_STORAGE_KEY, STORAGE_PREFIX, defaultSettings, parseSettings, type AppSettings } from '@/lib/settings/schema';

// Storage can throw (private mode, disabled site data, quota), so every access is guarded.

export function loadSettings(): AppSettings {
  try {
    return parseSettings(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings): boolean {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function storedKeys(): string[] {
  try {
    return Object.keys(window.localStorage).filter((key) => key.startsWith(STORAGE_PREFIX));
  } catch {
    return [];
  }
}

/** Copies everything OmniVoice OS keeps in browser storage. Values are parsed, so editing them is safe. */
export function readStoredData(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of storedKeys()) {
    const raw = window.localStorage.getItem(key);
    try {
      data[key] = raw === null ? null : JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }
  return data;
}

/** Removes everything OmniVoice OS keeps in browser storage and returns the removed keys. */
export function clearStoredData(): string[] {
  const keys = storedKeys();
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore: nothing else to do if storage refuses.
    }
  }
  return keys;
}
