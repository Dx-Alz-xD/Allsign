'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  TEXT_SCALE,
  defaultSettings,
  type AppSettings,
  type AudioSettings,
  type DisplaySettings,
  type LegalSettings,
  type NetworkSettings,
  type SpeechSettings,
} from '@/lib/settings/schema';
import { clearStoredData, loadSettings, saveSettings } from '@/lib/settings/storage';

interface SettingsContextValue {
  settings: AppSettings;
  /** False until saved settings have been read, so nothing overwrites them with defaults. */
  ready: boolean;
  /** Effective high contrast, resolving "follow system" against the OS preference. */
  highContrast: boolean;
  systemHighContrast: boolean;
  updateDisplay: (patch: Partial<DisplaySettings>) => void;
  updateAudio: (patch: Partial<AudioSettings>) => void;
  updateNetwork: (patch: Partial<NetworkSettings>) => void;
  updateSpeech: (patch: Partial<SpeechSettings>) => void;
  updateLegal: (patch: Partial<LegalSettings>) => void;
  /** Removes everything Voicematics stored in this browser profile and returns to defaults. */
  eraseLocalData: () => string[];
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const HIGH_CONTRAST_QUERY = '(prefers-contrast: more)';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [ready, setReady] = useState(false);
  const [systemHighContrast, setSystemHighContrast] = useState(false);
  const skipNextSave = useRef(false);

  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);

    const query = window.matchMedia(HIGH_CONTRAST_QUERY);
    setSystemHighContrast(query.matches);
    const handleChange = (event: MediaQueryListEvent) => setSystemHighContrast(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveSettings(settings);
  }, [settings, ready]);

  const highContrast = settings.display.highContrast ?? systemHighContrast;

  useEffect(() => {
    if (ready) document.documentElement.setAttribute('data-contrast', highContrast ? 'high' : 'standard');
  }, [highContrast, ready]);

  const { textScale } = settings.display;
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const bridge = window.omnivoice;
    if (bridge?.display) {
      // Page zoom reflows the layout (breakpoints included), which plain font scaling cannot do.
      bridge.display.setZoomFactor(textScale / 100);
      root.style.removeProperty('font-size');
    } else {
      root.style.fontSize = textScale === TEXT_SCALE.min ? '' : `${textScale}%`;
    }
  }, [textScale, ready]);

  const updateDisplay = useCallback(
    (patch: Partial<DisplaySettings>) => setSettings((current) => ({ ...current, display: { ...current.display, ...patch } })),
    [],
  );
  const updateAudio = useCallback(
    (patch: Partial<AudioSettings>) => setSettings((current) => ({ ...current, audio: { ...current.audio, ...patch } })),
    [],
  );
  const updateNetwork = useCallback(
    (patch: Partial<NetworkSettings>) => setSettings((current) => ({ ...current, network: { ...current.network, ...patch } })),
    [],
  );
  const updateSpeech = useCallback(
    (patch: Partial<SpeechSettings>) => setSettings((current) => ({ ...current, speech: { ...current.speech, ...patch } })),
    [],
  );
  const updateLegal = useCallback(
    (patch: Partial<LegalSettings>) => setSettings((current) => ({ ...current, legal: { ...current.legal, ...patch } })),
    [],
  );

  const eraseLocalData = useCallback(() => {
    const removed = clearStoredData();
    skipNextSave.current = true;
    setSettings(defaultSettings());
    return removed;
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      ready,
      highContrast,
      systemHighContrast,
      updateDisplay,
      updateAudio,
      updateNetwork,
      updateSpeech,
      updateLegal,
      eraseLocalData,
    }),
    [settings, ready, highContrast, systemHighContrast, updateDisplay, updateAudio, updateNetwork, updateSpeech, updateLegal, eraseLocalData],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside SettingsProvider.');
  return context;
}
