'use client';

/**
 * One live session for the whole app: the audio engine, the DSP workers, the
 * HUD telemetry store, the caregiver link, grammar reconstruction, direct
 * paste and trigger actions. Views read it with `useSession()`.
 *
 * Nothing starts until `startMicrophone()` is called from a user gesture.
 * Until then the telemetry store holds silent frames; Pitch Demo mode can
 * fall back to the built-in simulated signal.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  CaregiverAlert,
  CaregiverMessage,
  CaregiverRole,
  GrammarResponse,
  ProfileMode,
  SessionAnalytics,
} from '@shared/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useAudioPipeline, type AudioPipeline } from '@/hooks/useAudioPipeline';
import { makeAlert, performTriggerAction, typeIntoActiveApp, type ActionOutcome } from '@/lib/actions';
import { api, backendUrl, backendWebSocketUrl } from '@/lib/api/client';
import { getAudioEngine, type EngineSnapshot, type FluencySettings } from '@/lib/audio/engine';
import { startSimulatedAudio, simulatedGrammarAt, simulatedPeerAt } from '@/lib/hud/simulated';
import { createTelemetryStore } from '@/lib/hud/store';
import type { PeerLinkState, TelemetrySource } from '@/lib/hud/types';
import { CaregiverLink, toPeerLinkState, type CaregiverLinkState } from '@/lib/peer/caregiverLink';
import { iceServersFrom } from '@/lib/settings/network';
import { SystemDictationSource, systemDictationAvailable, type TokenSourceKind } from '@/lib/speech/tokenSource';
import type { TriggerMatch } from '@/workers/trigger.worker';

const TELEMETRY_HZ = 30;
const CAREGIVER_TELEMETRY_EVERY_TICKS = 8; // ~4 Hz
const HEALTH_POLL_MS = 30_000;
const MAX_ALERTS = 30;
const MIN_SESSION_SECONDS = 5;

export interface SessionContextValue {
  profile: ProfileMode;
  engine: EngineSnapshot;
  startMicrophone: () => Promise<void>;
  stopMicrophone: () => Promise<void>;
  /** True once audio flows through the workers. */
  live: boolean;
  pipeline: AudioPipeline;
  /** Live telemetry (silent frames while idle). */
  telemetry: TelemetrySource;
  /** Simulated telemetry for Pitch Demo when the microphone is off. */
  demoTelemetry: TelemetrySource;
  isSimulated: boolean;

  feedback: FluencySettings;
  feedbackEnabled: boolean;
  setFeedback: (patch: Partial<FluencySettings>) => void;
  setFeedbackEnabled: (enabled: boolean) => void;

  grammar: GrammarResponse | null;
  grammarError: string | null;
  grammarBusy: boolean;
  interimTokens: string[];
  submitTokens: (tokens: string[]) => Promise<GrammarResponse | null>;
  tokenSourceKind: TokenSourceKind;
  setTokenSourceKind: (kind: TokenSourceKind) => void;
  dictationAvailable: boolean;
  dictationActive: boolean;
  setDictationActive: (active: boolean) => void;

  directPasteActive: boolean;
  setDirectPasteActive: (active: boolean) => void;
  lastPasteDetail: string | null;
  typeText: (text: string) => Promise<void>;

  link: CaregiverLinkState | null;
  peer: PeerLinkState;
  connectCaregiver: (room: string, role: CaregiverRole) => void;
  disconnectCaregiver: () => void;
  alerts: CaregiverAlert[];
  /** Frames received from the speaker while this device is the caregiver. */
  remoteTelemetry: TelemetrySource;
  sendEmergency: () => void;

  lastMatch: TriggerMatch | null;
  lastAction: ActionOutcome | null;

  backendOnline: boolean | null;
  warning: string | null;

  recordSession: () => Promise<SessionAnalytics | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider.');
  return context;
}

interface SessionProviderProps {
  profile: ProfileMode;
  muted: boolean;
  children: ReactNode;
}

const DEFAULT_FEEDBACK: FluencySettings = { dafDelayMs: 60, fsfOctaveShift: 0, feedbackGain: 1 };

export function SessionProvider({ profile, muted, children }: SessionProviderProps) {
  const { settings } = useSettings();
  const engine = useMemo(() => getAudioEngine(), []);
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot>(() => engine.getSnapshot());
  const [warning, setWarning] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  const [telemetry] = useState(createTelemetryStore);
  const [demoTelemetry] = useState(createTelemetryStore);
  const [remoteTelemetry] = useState(createTelemetryStore);

  const [feedback, setFeedbackState] = useState<FluencySettings>(DEFAULT_FEEDBACK);
  const [feedbackEnabled, setFeedbackEnabledState] = useState(false);

  const [grammar, setGrammar] = useState<GrammarResponse | null>(null);
  const [grammarError, setGrammarError] = useState<string | null>(null);
  const [grammarBusy, setGrammarBusy] = useState(false);
  const [interimTokens, setInterimTokens] = useState<string[]>([]);
  const [tokenSourceKind, setTokenSourceKind] = useState<TokenSourceKind>('manual');
  const [dictationActive, setDictationActiveState] = useState(false);

  const [directPasteActive, setDirectPasteActive] = useState(false);
  const [lastPasteDetail, setLastPasteDetail] = useState<string | null>(null);

  const [link, setLink] = useState<CaregiverLinkState | null>(null);
  const [alerts, setAlerts] = useState<CaregiverAlert[]>([]);
  const [lastMatch, setLastMatch] = useState<TriggerMatch | null>(null);
  const [lastAction, setLastAction] = useState<ActionOutcome | null>(null);

  const linkRef = useRef<CaregiverLink | null>(null);
  const dictationRef = useRef<SystemDictationSource | null>(null);
  const directPasteRef = useRef(directPasteActive);
  directPasteRef.current = directPasteActive;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const pushAlert = useCallback((alert: CaregiverAlert) => {
    setAlerts((current) => [alert, ...current].slice(0, MAX_ALERTS));
  }, []);

  const sendToCaregiver = useCallback((message: CaregiverMessage): boolean => linkRef.current?.send(message) ?? false, []);

  // --- workers -------------------------------------------------------------

  const createAudioWorker = useCallback(() => new Worker(new URL('../../workers/audio.worker.ts', import.meta.url)), []);
  const createBiomarkerWorker = useCallback(() => new Worker(new URL('../../workers/biomarker.worker.ts', import.meta.url)), []);
  const createFormantWorker = useCallback(() => new Worker(new URL('../../workers/formant.worker.ts', import.meta.url)), []);
  const createTriggerWorker = useCallback(() => new Worker(new URL('../../workers/trigger.worker.ts', import.meta.url)), []);
  const createCadenceWorker = useCallback(() => new Worker(new URL('../../workers/cadence.worker.ts', import.meta.url)), []);
  const triggerConfig = useMemo(() => ({ apiBaseUrl: backendUrl() }), []);

  const onTriggerMatch = useCallback(
    (match: TriggerMatch) => {
      setLastMatch(match);
      void performTriggerAction(match, { sendToCaregiver }).then((outcome) => {
        setLastAction(outcome);
        if (outcome.action === 'WEBRTC_ALERT' && outcome.ok) pushAlert(makeAlert('trigger', match.mappedPhrase));
      });
    },
    [pushAlert, sendToCaregiver],
  );

  const pipeline = useAudioPipeline({
    createAudioWorker,
    createBiomarkerWorker,
    createFormantWorker,
    createTriggerWorker,
    createCadenceWorker,
    triggerConfig,
    onTriggerMatch,
    onWarning: setWarning,
    onError: setWarning,
  });
  const { attachCapture, getHudFrame, setFeedbackState: mirrorFeedback, getSessionStats, reset: resetPipeline } = pipeline;

  // --- engine --------------------------------------------------------------

  useEffect(() => engine.subscribe(setEngineSnapshot), [engine]);

  useEffect(() => {
    engine.setMuted(muted);
  }, [engine, muted]);

  const startMicrophone = useCallback(async () => {
    await engine.start({ inputDeviceId: settings.audio.inputDeviceId, outputDeviceId: settings.audio.outputDeviceId });
    const port = engine.capturePort;
    if (port) attachCapture(port, (message) => engine.handleCaptureMessage(message));
    engine.applyFluency(feedback);
    engine.setFeedbackEnabled(feedbackEnabled);
    resetPipeline();
  }, [attachCapture, engine, feedback, feedbackEnabled, resetPipeline, settings.audio.inputDeviceId, settings.audio.outputDeviceId]);

  const live = engineSnapshot.state === 'running' && pipeline.status === 'running';

  const recordSession = useCallback(async (): Promise<SessionAnalytics | null> => {
    const stats = getSessionStats();
    if (stats.sessionDurationSeconds < MIN_SESSION_SECONDS) return null;
    try {
      return await api.sessions.record({ ...stats, profileMode: profileRef.current });
    } catch (error) {
      setWarning(`Session was not saved: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }, [getSessionStats]);

  const stopMicrophone = useCallback(async () => {
    if (engine.getSnapshot().state === 'running') await recordSession();
    await engine.stop();
  }, [engine, recordSession]);

  // --- feedback (DAF / FSF) ------------------------------------------------

  const setFeedback = useCallback((patch: Partial<FluencySettings>) => {
    setFeedbackState((current) => ({ ...current, ...patch }));
  }, []);

  const setFeedbackEnabled = useCallback(
    (enabled: boolean) => {
      setFeedbackEnabledState(enabled);
      engine.setFeedbackEnabled(enabled);
    },
    [engine],
  );

  useEffect(() => {
    engine.applyFluency(feedback);
    mirrorFeedback({
      dafDelayMs: feedbackEnabled ? feedback.dafDelayMs : 0,
      fsfOctaveShift: feedbackEnabled ? feedback.fsfOctaveShift : 0,
    });
  }, [engine, feedback, feedbackEnabled, mirrorFeedback]);

  // --- telemetry feed ------------------------------------------------------

  useEffect(() => {
    let ticks = 0;
    let blocked = false;
    let fatigued = false;
    const timer = window.setInterval(() => {
      const frame = getHudFrame();
      telemetry.push(frame);
      ticks += 1;

      const snapshot = pipeline.snapshotRef.current;
      if (snapshot.cadence.vocalBlockDetected && !blocked) {
        const alert = makeAlert('vocal-block', 'Vocal block detected', snapshot.cadence.blockDurationMs);
        pushAlert(alert);
        sendToCaregiver({ type: 'alert', alert });
      }
      blocked = snapshot.cadence.vocalBlockDetected;

      if (snapshot.fatigueWarning && !fatigued) {
        const alert = makeAlert('fatigue', `Vocal strain is high (${Math.round(snapshot.strainSmoothed)} of 100)`);
        pushAlert(alert);
        sendToCaregiver({ type: 'alert', alert });
      }
      fatigued = snapshot.fatigueWarning;

      if (ticks % CAREGIVER_TELEMETRY_EVERY_TICKS === 0 && linkRef.current?.connected) {
        sendToCaregiver({ type: 'telemetry', telemetry: frame.telemetry, fluency: frame.fluency, latencyMs: frame.latencyMs });
      }
    }, 1000 / TELEMETRY_HZ);
    return () => window.clearInterval(timer);
  }, [getHudFrame, pipeline.snapshotRef, pushAlert, sendToCaregiver, telemetry]);

  // Pitch Demo keeps the simulated signal while no microphone runs.
  const isSimulated = profile === 'pitch_demo' && !live;
  useEffect(() => {
    if (!isSimulated) return;
    return startSimulatedAudio(demoTelemetry);
  }, [demoTelemetry, isSimulated]);

  // --- backend health ------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const probe = () =>
      api
        .health()
        .then(() => !cancelled && setBackendOnline(true))
        .catch(() => !cancelled && setBackendOnline(false));
    void probe();
    const timer = window.setInterval(() => void probe(), HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // --- grammar -------------------------------------------------------------

  const typeText = useCallback(async (text: string) => {
    const result = await typeIntoActiveApp(text);
    setLastPasteDetail(result.detail);
  }, []);

  const submitTokens = useCallback(
    async (tokens: string[]): Promise<GrammarResponse | null> => {
      if (tokens.length === 0) return null;
      setGrammarBusy(true);
      setGrammarError(null);
      try {
        const response = await api.grammar.translate({ rawSpeechTokens: tokens, sourceLang: 'en', targetProfile: profileRef.current });
        setGrammar(response);
        setInterimTokens([]);
        if (directPasteRef.current && response.formattedText) await typeText(response.formattedText);
        return response;
      } catch (error) {
        setGrammarError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        setGrammarBusy(false);
      }
    },
    [typeText],
  );

  const setDictationActive = useCallback(
    (active: boolean) => {
      if (!active) {
        dictationRef.current?.stop();
        dictationRef.current = null;
        setDictationActiveState(false);
        setInterimTokens([]);
        return;
      }
      const source = new SystemDictationSource(
        (batch) => {
          if (batch.final) void submitTokens(batch.tokens);
          else setInterimTokens(batch.tokens);
        },
        (message) => {
          setGrammarError(message);
          setDictationActiveState(false);
          dictationRef.current = null;
        },
      );
      dictationRef.current = source;
      source.start();
      setDictationActiveState(source.active);
    },
    [submitTokens],
  );

  useEffect(() => () => dictationRef.current?.stop(), []);

  // --- caregiver link ------------------------------------------------------

  const disconnectCaregiver = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    setLink(null);
  }, []);

  const connectCaregiver = useCallback(
    (room: string, role: CaregiverRole) => {
      linkRef.current?.close();
      const next = new CaregiverLink({
        role,
        room,
        signalUrl: backendWebSocketUrl(),
        iceServers: iceServersFrom(settings.network),
        onState: setLink,
        onMessage: (message) => {
          if (message.type === 'alert') {
            pushAlert(message.alert);
            return;
          }
          const current = remoteTelemetry.getFrame();
          remoteTelemetry.push({
            telemetry: message.telemetry,
            fluency: message.fluency,
            waveform: current.waveform,
            spectrumMaxHz: current.spectrumMaxHz,
            latencyMs: message.latencyMs,
          });
        },
      });
      linkRef.current = next;
      next.connect();
    },
    [pushAlert, remoteTelemetry, settings.network],
  );

  useEffect(() => () => linkRef.current?.close(), []);

  const sendEmergency = useCallback(() => {
    const alert = makeAlert('emergency', 'Emergency alert raised from the speaker device');
    pushAlert(alert);
    sendToCaregiver({ type: 'alert', alert });
  }, [pushAlert, sendToCaregiver]);

  const peer = useMemo<PeerLinkState>(() => {
    if (link) return toPeerLinkState(link);
    return isSimulated ? simulatedPeerAt(2) : toPeerLinkState(null);
  }, [isSimulated, link]);

  const shownGrammar = grammar ?? (isSimulated ? simulatedGrammarAt(0) : null);

  const value = useMemo<SessionContextValue>(
    () => ({
      profile,
      engine: engineSnapshot,
      startMicrophone,
      stopMicrophone,
      live,
      pipeline,
      telemetry,
      demoTelemetry,
      isSimulated,
      feedback,
      feedbackEnabled,
      setFeedback,
      setFeedbackEnabled,
      grammar: shownGrammar,
      grammarError,
      grammarBusy,
      interimTokens,
      submitTokens,
      tokenSourceKind,
      setTokenSourceKind,
      dictationAvailable: systemDictationAvailable(),
      dictationActive,
      setDictationActive,
      directPasteActive,
      setDirectPasteActive,
      lastPasteDetail,
      typeText,
      link,
      peer,
      connectCaregiver,
      disconnectCaregiver,
      alerts,
      remoteTelemetry,
      sendEmergency,
      lastMatch,
      lastAction,
      backendOnline,
      warning,
      recordSession,
    }),
    [
      profile,
      engineSnapshot,
      startMicrophone,
      stopMicrophone,
      live,
      pipeline,
      telemetry,
      demoTelemetry,
      isSimulated,
      feedback,
      feedbackEnabled,
      setFeedback,
      setFeedbackEnabled,
      shownGrammar,
      grammarError,
      grammarBusy,
      interimTokens,
      submitTokens,
      tokenSourceKind,
      dictationActive,
      setDictationActive,
      directPasteActive,
      lastPasteDetail,
      typeText,
      link,
      peer,
      connectCaregiver,
      disconnectCaregiver,
      alerts,
      remoteTelemetry,
      sendEmergency,
      lastMatch,
      lastAction,
      backendOnline,
      warning,
      recordSession,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
