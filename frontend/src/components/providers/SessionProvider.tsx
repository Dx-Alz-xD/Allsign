'use client';

/**
 * One live session for the whole app: the audio engine, the DSP workers, the
 * HUD telemetry store, the caregiver link, grammar reconstruction, direct
 * paste and trigger actions. Views read it with `useSession()`.
 *
 * Nothing starts until `startMicrophone()` is called from a user gesture.
 * Until then the telemetry store holds silent frames; Pitch Demo mode can
 * fall back to the built-in simulated signal.
 *
 * Speech path: every token source (typed text, system dictation, the Pitch
 * Mode demo script) feeds speech.worker, which segments utterances and calls
 * the grammar engine (POST /api/grammar/translate) strictly in order. Each
 * translation then goes, in that same order, to the direct paste queue
 * (nut.js through the desktop bridge) and to the caregiver data channel's
 * broadcast queue.
 *
 * In ClearVoice and Aphasia Mode, once a translation is on screen, Gemini is
 * asked for a context-aware second answer (POST /api/agent/refine-sentence)
 * with the last few sentences. It is shown under the grammar engine's
 * sentence and never delays or replaces it.
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
  CaregiverTranscript,
  GrammarResponse,
  ProfileMode,
  RefineProfile,
  SessionAnalytics,
  SessionLog,
  SpeechSource,
} from '@shared/types';
import { useAccount } from '@/components/providers/AccountProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useAudioPipeline, type AudioPipeline } from '@/hooks/useAudioPipeline';
import { makeAlert, performTriggerAction, typeIntoActiveApp, type ActionOutcome } from '@/lib/actions';
import { SessionLogRecorder } from '@/lib/analytics/sessionLog';
import { api, ApiError, backendUrl, backendWebSocketUrl, getAuthToken } from '@/lib/api/client';
import { getAudioEngine, type EngineSnapshot, type FluencySettings } from '@/lib/audio/engine';
import { DEMO_TOKEN_SCRIPT, startSimulatedAudio, simulatedGrammarAt, simulatedPeerAt } from '@/lib/hud/simulated';
import { createTelemetryStore } from '@/lib/hud/store';
import type { PeerLinkState, TelemetrySource } from '@/lib/hud/types';
import { createPasteQueue } from '@/lib/output/pasteQueue';
import { CaregiverLink, generateClientId, toPeerLinkState, type CaregiverLinkState } from '@/lib/peer/caregiverLink';
import type { Delivery } from '@/lib/peer/outbox';
import { iceServersFrom } from '@/lib/settings/network';
import { SystemDictationSource, systemDictationAvailable, type TokenSourceKind } from '@/lib/speech/tokenSource';
import type { SpeechWorkerRequest, SpeechWorkerResponse } from '@/workers/speech.worker';
import type { TriggerMatch } from '@/workers/trigger.worker';

const TELEMETRY_HZ = 30;
const CAREGIVER_TELEMETRY_EVERY_TICKS = 8; // ~4 Hz
const HEALTH_POLL_MS = 30_000;
const MAX_ALERTS = 30;
const MAX_TRANSCRIPTS = 30;
const MIN_SESSION_SECONDS = 5;
/** backend grammar_engine.LATENCY_BUDGET_MS, until the health check reports it. */
const DEFAULT_AST_BUDGET_MS = 10;
/** Pitch Mode replays one demo sentence through the real grammar engine this often. */
const DEMO_SENTENCE_INTERVAL_MS = 8000;
const CLIENT_ID_STORAGE_KEY = 'omnivoice:caregiver-client-id';
/** Earlier sentences sent with each Gemini request, so it can follow the conversation. */
const REFINE_CONTEXT_SENTENCES = 6;
/** backend sentence_refiner.MAX_SENTENCE_CHARS */
const REFINE_MAX_SENTENCE_CHARS = 500;

/** The profiles that show a second, Gemini-written answer under the grammar engine's sentence. */
function refineProfileOf(profile: ProfileMode): RefineProfile | null {
  return profile === 'clearvoice' || profile === 'aphasia' ? profile : null;
}

function refinementFailure(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 502) return 'Gemini did not give a usable answer this time.';
    if (cause.status === 429) return 'Too many Gemini requests this minute; the next sentence will try again.';
    return typeof cause.detail === 'string' && cause.detail ? cause.detail : `The Gemini answer failed (${cause.status}).`;
  }
  if (cause instanceof DOMException && cause.name === 'AbortError') return 'Gemini took too long to answer.';
  return 'Could not reach the server for the Gemini answer.';
}

/** One id per browser tab, kept across reloads, so the relay lets a reloaded tab take its role back. */
function tabClientId(): string {
  try {
    const stored = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const created = generateClientId();
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return generateClientId();
  }
}

export type GrammarSource = SpeechSource | 'simulated';

/** Gemini's answer for one grammar engine response, matched to it by identity. */
export type SentenceRefinement =
  | { status: 'pending'; grammar: GrammarResponse }
  | { status: 'ready'; grammar: GrammarResponse; text: string; modelName: string; latencyMs: number }
  | { status: 'failed'; grammar: GrammarResponse; message: string };

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
  /** Where the shown sentence came from; 'simulated' is canned output while the grammar server is offline. */
  grammarSource: GrammarSource | null;
  /** speech.worker request start to parsed response, for the shown sentence. */
  grammarRoundTripMs: number | null;
  /** The grammar engine's parse budget (GET /health). */
  astBudgetMs: number;
  grammarError: string | null;
  grammarBusy: boolean;
  /** Gemini's context-aware answer for the shown sentence; null when it was not asked for one. */
  refinement: SentenceRefinement | null;
  /** Whether ClearVoice and Aphasia Mode ask Gemini for that second answer (saved in settings). */
  geminiAnswer: boolean;
  setGeminiAnswer: (enabled: boolean) => void;
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
  /** Sentences received from the speaker, newest first. */
  remoteTranscripts: CaregiverTranscript[];
  /** Null when no caregiver link is set up; otherwise whether the alert went out now or waits for the connection. */
  sendEmergency: () => Delivery | null;

  lastMatch: TriggerMatch | null;
  lastAction: ActionOutcome | null;

  backendOnline: boolean | null;
  warning: string | null;

  /** Saves the session to the account's history; null when it is too short or the plan has no analytics. */
  recordSession: () => Promise<SessionAnalytics | null>;
  /** Biomarker samples, feedback changes and blocks of the current session, for a clinical report. */
  getSessionLog: () => SessionLog | null;
  /** Starts the session statistics and the report log over, keeping the microphone on. */
  startNewSession: () => void;
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
  const { settings, updateSpeech } = useSettings();
  const account = useAccount();
  const analyticsRef = useRef(account.has('analytics'));
  analyticsRef.current = account.has('analytics');
  const sessionLogRef = useRef(new SessionLogRecorder());
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
  const [grammarSource, setGrammarSource] = useState<SpeechSource | null>(null);
  const [grammarRoundTripMs, setGrammarRoundTripMs] = useState<number | null>(null);
  const [astBudgetMs, setAstBudgetMs] = useState(DEFAULT_AST_BUDGET_MS);
  const [grammarError, setGrammarError] = useState<string | null>(null);
  const [grammarBusy, setGrammarBusy] = useState(false);
  const [refinement, setRefinement] = useState<SentenceRefinement | null>(null);
  const [interimTokens, setInterimTokens] = useState<string[]>([]);
  const [tokenSourceKind, setTokenSourceKind] = useState<TokenSourceKind>('manual');
  const [dictationActive, setDictationActiveState] = useState(false);
  // Only known in the browser; checking during render would make the prerendered HTML disagree with the client.
  const [dictationAvailable, setDictationAvailable] = useState(false);
  useEffect(() => setDictationAvailable(systemDictationAvailable()), []);

  const [directPasteActive, setDirectPasteActiveState] = useState(false);
  const [lastPasteDetail, setLastPasteDetail] = useState<string | null>(null);

  const [link, setLink] = useState<CaregiverLinkState | null>(null);
  const [alerts, setAlerts] = useState<CaregiverAlert[]>([]);
  const [remoteTranscripts, setRemoteTranscripts] = useState<CaregiverTranscript[]>([]);
  const [lastMatch, setLastMatch] = useState<TriggerMatch | null>(null);
  const [lastAction, setLastAction] = useState<ActionOutcome | null>(null);

  const linkRef = useRef<CaregiverLink | null>(null);
  const dictationRef = useRef<SystemDictationSource | null>(null);
  const speechWorkerRef = useRef<Worker | null>(null);
  /** submitTokens promises, by the requestId echoed on the utterance. */
  const pendingSubmissionsRef = useRef(new Map<string, (response: GrammarResponse | null) => void>());
  const requestCounterRef = useRef(0);
  const directPasteRef = useRef(directPasteActive);
  directPasteRef.current = directPasteActive;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const geminiAnswer = settings.speech.geminiAnswer;
  const geminiAnswerRef = useRef(geminiAnswer);
  geminiAnswerRef.current = geminiAnswer;
  /** Recent sentences, oldest first: Gemini's answer where it gave one, otherwise the grammar engine's. */
  const conversationRef = useRef<{ text: string }[]>([]);

  const pushAlert = useCallback((alert: CaregiverAlert) => {
    setAlerts((current) => [alert, ...current].slice(0, MAX_ALERTS));
  }, []);

  /** Best effort, for live telemetry only. */
  const sendToCaregiver = useCallback((message: CaregiverMessage): boolean => linkRef.current?.send(message) ?? false, []);
  /** Alerts and sentences: in order, queued until the data channel opens. Null when no link is set up. */
  const broadcastToCaregiver = useCallback((message: CaregiverMessage): Delivery | null => linkRef.current?.broadcast(message) ?? null, []);

  // --- workers -------------------------------------------------------------

  const createAudioWorker = useCallback(() => new Worker(new URL('../../workers/audio.worker.ts', import.meta.url)), []);
  const createBiomarkerWorker = useCallback(() => new Worker(new URL('../../workers/biomarker.worker.ts', import.meta.url)), []);
  const createFormantWorker = useCallback(() => new Worker(new URL('../../workers/formant.worker.ts', import.meta.url)), []);
  const createTriggerWorker = useCallback(() => new Worker(new URL('../../workers/trigger.worker.ts', import.meta.url)), []);
  const createCadenceWorker = useCallback(() => new Worker(new URL('../../workers/cadence.worker.ts', import.meta.url)), []);
  // Read once when the worker starts; later changes arrive through setTriggerAccount below.
  const triggerConfig = useMemo(
    () => ({ apiBaseUrl: backendUrl(), authToken: getAuthToken() ?? '', triggerLimit: account.entitlements.triggerLimit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onTriggerMatch = useCallback(
    (match: TriggerMatch) => {
      setLastMatch(match);
      void performTriggerAction(match, { broadcastToCaregiver }).then((outcome) => {
        setLastAction(outcome);
        if (outcome.action === 'WEBRTC_ALERT' && outcome.ok) pushAlert(makeAlert('trigger', match.mappedPhrase));
      });
    },
    [broadcastToCaregiver, pushAlert],
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
  const {
    attachCapture,
    getHudFrame,
    setFeedbackState: mirrorFeedback,
    getSessionStats,
    reset: resetPipeline,
    setTriggerAccount,
  } = pipeline;

  // Each confirmation of the account (every few minutes, on focus, after renewal) also re-reads its triggers,
  // so ones saved on another computer show up here.
  const confirmedRef = useRef(account.refreshedAt);
  useEffect(() => {
    const reload = account.refreshedAt !== confirmedRef.current;
    confirmedRef.current = account.refreshedAt;
    setTriggerAccount(account.token ?? '', account.entitlements.triggerLimit, reload);
  }, [account.entitlements.triggerLimit, account.refreshedAt, account.token, setTriggerAccount]);

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
    sessionLogRef.current.start(performance.now());
  }, [attachCapture, engine, feedback, feedbackEnabled, resetPipeline, settings.audio.inputDeviceId, settings.audio.outputDeviceId]);

  const live = engineSnapshot.state === 'running' && pipeline.status === 'running';

  const recordSession = useCallback(async (): Promise<SessionAnalytics | null> => {
    const stats = getSessionStats();
    if (stats.sessionDurationSeconds < MIN_SESSION_SECONDS || !analyticsRef.current) return null;
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
    sessionLogRef.current.feedbackChanged(feedbackEnabled, feedback.dafDelayMs, feedback.fsfOctaveShift, performance.now());
  }, [feedback.dafDelayMs, feedback.fsfOctaveShift, feedbackEnabled]);

  const startNewSession = useCallback(() => {
    resetPipeline();
    conversationRef.current = [];
    sessionLogRef.current.start(performance.now());
  }, [resetPipeline]);

  const getSessionLog = useCallback((): SessionLog | null => {
    const recorder = sessionLogRef.current;
    if (!recorder.started) return null;
    const { speakingMs, ready } = pipeline.snapshotRef.current.cadence;
    return recorder.toLog(profileRef.current, ready ? speakingMs : null, performance.now());
  }, [pipeline.snapshotRef]);

  useEffect(() => {
    engine.applyFluency(feedback);
    mirrorFeedback({
      dafDelayMs: feedbackEnabled ? feedback.dafDelayMs : 0,
      fsfOctaveShift: feedbackEnabled ? feedback.fsfOctaveShift : 0,
    });
  }, [engine, feedback, feedbackEnabled, mirrorFeedback]);

  // --- telemetry feed ------------------------------------------------------

  const postSpeech = useCallback((request: SpeechWorkerRequest) => speechWorkerRef.current?.postMessage(request), []);

  useEffect(() => {
    let ticks = 0;
    let blocked = false;
    let blocksAtStart = 0;
    let fatigued = false;
    let voiceActive = false;
    const timer = window.setInterval(() => {
      const frame = getHudFrame();
      telemetry.push(frame);
      ticks += 1;

      const snapshot = pipeline.snapshotRef.current;
      sessionLogRef.current.sample(
        {
          voiced: snapshot.voiced,
          biomarkersReady: snapshot.biomarkersReady,
          jitterPercent: snapshot.jitterPercent,
          shimmerDb: snapshot.shimmerDb,
          hnrDb: snapshot.hnrDb,
          strainIndex: snapshot.vocalStrainIndex,
          pitchHz: snapshot.pitchHz,
        },
        performance.now(),
      );
      // While cadence.worker hears an utterance, speech.worker holds its idle flush so a block does not split a sentence.
      if (snapshot.cadence.utteranceActive !== voiceActive) {
        voiceActive = snapshot.cadence.utteranceActive;
        postSpeech({ type: 'voice', active: voiceActive });
      }

      // A block is only reported once speech resumes: a gap that runs into the end of the utterance is a pause,
      // and cadence.worker takes it back out of blockCount.
      const { vocalBlockDetected, blockCount, blockDurationMs } = snapshot.cadence;
      if (vocalBlockDetected && !blocked) blocksAtStart = blockCount;
      if (!vocalBlockDetected && blocked && blockCount >= blocksAtStart) {
        const alert = makeAlert('vocal-block', 'Vocal block', blockDurationMs);
        sessionLogRef.current.block(blockDurationMs, performance.now());
        pushAlert(alert);
        broadcastToCaregiver({ type: 'alert', alert });
      }
      blocked = vocalBlockDetected;

      if (snapshot.fatigueWarning && !fatigued) {
        const alert = makeAlert('fatigue', `Vocal strain is high (${Math.round(snapshot.strainSmoothed)} of 100)`);
        pushAlert(alert);
        broadcastToCaregiver({ type: 'alert', alert });
      }
      fatigued = snapshot.fatigueWarning;

      if (ticks % CAREGIVER_TELEMETRY_EVERY_TICKS === 0 && linkRef.current?.connected) {
        sendToCaregiver({ type: 'telemetry', telemetry: frame.telemetry, fluency: frame.fluency, latencyMs: frame.latencyMs });
      }
    }, 1000 / TELEMETRY_HZ);
    return () => window.clearInterval(timer);
  }, [broadcastToCaregiver, getHudFrame, pipeline.snapshotRef, postSpeech, pushAlert, sendToCaregiver, telemetry]);

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

  // --- speech -> grammar -> paste + caregiver --------------------------------

  const pasteQueue = useMemo(
    () =>
      createPasteQueue({
        type: (text) => typeIntoActiveApp(text),
        onOutcome: (outcome) => setLastPasteDetail(outcome.detail),
      }),
    [],
  );

  const setDirectPasteActive = useCallback(
    (active: boolean) => {
      setDirectPasteActiveState(active);
      // The person has probably moved to a new text field, so the next sentence starts without a space.
      if (active) pasteQueue.restart();
    },
    [pasteQueue],
  );

  const typeText = useCallback(
    async (text: string) => {
      pasteQueue.enqueue(text);
      await pasteQueue.idle();
    },
    [pasteQueue],
  );

  const requestRefinement = useCallback((response: GrammarResponse, profileMode: RefineProfile) => {
    const context = conversationRef.current.map((entry) => entry.text);
    const entry = { text: response.formattedText.slice(0, REFINE_MAX_SENTENCE_CHARS) };
    conversationRef.current = [...conversationRef.current, entry].slice(-REFINE_CONTEXT_SENTENCES);
    setRefinement({ status: 'pending', grammar: response });
    const started = performance.now();
    // Only the answer for the newest sentence is shown; an older one arriving late just updates the context.
    const settle = (next: SentenceRefinement) => setRefinement((current) => (current?.grammar === response ? next : current));
    api.agent
      .refineSentence({ rawTokens: response.originalTokens, draft: entry.text, profileMode, context })
      .then((answer) => {
        entry.text = answer.text.slice(0, REFINE_MAX_SENTENCE_CHARS);
        settle({ status: 'ready', grammar: response, text: answer.text, modelName: answer.modelName, latencyMs: performance.now() - started });
      })
      .catch((cause: unknown) => settle({ status: 'failed', grammar: response, message: refinementFailure(cause) }));
  }, []);

  const setGeminiAnswer = useCallback(
    (enabled: boolean) => {
      updateSpeech({ geminiAnswer: enabled });
      if (!enabled) setRefinement(null);
    },
    [updateSpeech],
  );

  const settleSubmission = useCallback((requestId: string | null, response: GrammarResponse | null) => {
    if (!requestId) return;
    const resolve = pendingSubmissionsRef.current.get(requestId);
    pendingSubmissionsRef.current.delete(requestId);
    resolve?.(response);
  }, []);

  const handleSpeechMessage = useCallback(
    (message: SpeechWorkerResponse) => {
      switch (message.type) {
        case 'ready':
          return;
        case 'interim':
          setInterimTokens(message.tokens);
          return;
        case 'utterance':
          setGrammarBusy(true);
          return;
        case 'translation': {
          const { grammar: response, utterance, roundTripMs } = message.translation;
          setGrammarBusy(message.pending > 0);
          setGrammar(response);
          setGrammarSource(utterance.source);
          setGrammarRoundTripMs(roundTripMs);
          setGrammarError(null);
          setInterimTokens([]);

          // Demo sentences are for the screen, never typed into someone's apps.
          if (utterance.source !== 'demo' && directPasteRef.current && response.formattedText) {
            pasteQueue.enqueue(response.formattedText);
          }
          const refineProfile = refineProfileOf(profileRef.current);
          if (utterance.source !== 'demo' && refineProfile && geminiAnswerRef.current && response.originalTokens.length > 0) {
            requestRefinement(response, refineProfile);
          } else {
            setRefinement(null);
          }
          const transcript: CaregiverTranscript = {
            id: `${utterance.openedAt}-${utterance.id}-${utterance.part}`,
            source: utterance.source,
            grammar: response,
            roundTripMs,
            timestamp: Date.now(),
          };
          broadcastToCaregiver({ type: 'transcript', transcript });

          if (utterance.part === utterance.parts) settleSubmission(utterance.requestId, response);
          return;
        }
        case 'translationFailed':
          setGrammarBusy(message.pending > 0);
          setGrammarError(
            message.retryInMs === null
              ? message.message
              : `${message.message} Trying again in ${Math.max(1, Math.round(message.retryInMs / 1000))} s.`,
          );
          if (message.retryInMs === null) settleSubmission(message.utterance.requestId, null);
          return;
        case 'dropped':
          setGrammarBusy(message.pending > 0);
          setGrammarError(message.message);
          settleSubmission(message.utterance.requestId, null);
          return;
        case 'error':
          setGrammarError(message.message);
          return;
      }
    },
    [broadcastToCaregiver, pasteQueue, requestRefinement, settleSubmission],
  );

  const speechHandlerRef = useRef(handleSpeechMessage);
  speechHandlerRef.current = handleSpeechMessage;

  useEffect(() => {
    const worker = new Worker(new URL('../../workers/speech.worker.ts', import.meta.url));
    speechWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SpeechWorkerResponse>) => speechHandlerRef.current(event.data);
    worker.onerror = (event) => setGrammarError(`The speech worker stopped: ${event.message || 'unknown error'}`);
    worker.postMessage({
      type: 'init',
      config: { apiBaseUrl: backendUrl(), sourceLang: 'en', targetProfile: profileRef.current },
    } satisfies SpeechWorkerRequest);

    const pending = pendingSubmissionsRef.current;
    return () => {
      speechWorkerRef.current = null;
      worker.postMessage({ type: 'close' } satisfies SpeechWorkerRequest);
      worker.terminate();
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    postSpeech({ type: 'configure', config: { targetProfile: profile } });
  }, [postSpeech, profile]);

  // A dictated sentence waiting for the grammar server is retried as soon as the server answers again,
  // and the engine's parse budget is read once per reconnection.
  useEffect(() => {
    if (!backendOnline) return;
    postSpeech({ type: 'online' });
    let cancelled = false;
    api
      .healthReport()
      .then((report) => {
        if (!cancelled && Number.isFinite(report.astEngine.budgetMs)) setAstBudgetMs(report.astEngine.budgetMs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [backendOnline, postSpeech]);

  const submitTokens = useCallback(
    (tokens: string[]): Promise<GrammarResponse | null> => {
      if (tokens.length === 0 || !speechWorkerRef.current) return Promise.resolve(null);
      requestCounterRef.current += 1;
      const requestId = `submit-${requestCounterRef.current}`;
      setGrammarError(null);
      return new Promise((resolve) => {
        pendingSubmissionsRef.current.set(requestId, resolve);
        postSpeech({ type: 'tokens', tokens, final: true, source: 'manual', endOfUtterance: true, requestId });
      });
    },
    [postSpeech],
  );

  const setDictationActive = useCallback(
    (active: boolean) => {
      if (!active) {
        dictationRef.current?.stop();
        dictationRef.current = null;
        setDictationActiveState(false);
        setInterimTokens([]);
        // Whatever was dictated so far is still a sentence.
        postSpeech({ type: 'flush' });
        return;
      }
      const source = new SystemDictationSource(
        (batch) => postSpeech({ type: 'tokens', tokens: batch.tokens, final: batch.final, source: 'system-dictation' }),
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
    [postSpeech],
  );

  useEffect(() => () => dictationRef.current?.stop(), []);

  // --- caregiver link ------------------------------------------------------

  const disconnectCaregiver = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    setLink(null);
    setRemoteTranscripts([]);
  }, []);

  const connectCaregiver = useCallback(
    (room: string, role: CaregiverRole) => {
      linkRef.current?.close();
      const next = new CaregiverLink({
        role,
        room,
        clientId: tabClientId(),
        getAuthToken,
        signalUrl: backendWebSocketUrl(),
        iceServers: iceServersFrom(settings.network),
        onState: setLink,
        onMessage: (message) => {
          switch (message.type) {
            case 'alert':
              pushAlert(message.alert);
              return;
            case 'transcript':
              setRemoteTranscripts((current) =>
                [message.transcript, ...current.filter((item) => item.id !== message.transcript.id)].slice(0, MAX_TRANSCRIPTS),
              );
              return;
            case 'telemetry': {
              const current = remoteTelemetry.getFrame();
              remoteTelemetry.push({
                telemetry: message.telemetry,
                fluency: message.fluency,
                waveform: current.waveform,
                spectrumMaxHz: current.spectrumMaxHz,
                latencyMs: message.latencyMs,
              });
              return;
            }
          }
        },
      });
      linkRef.current = next;
      setRemoteTranscripts([]);
      next.connect();
    },
    [pushAlert, remoteTelemetry, settings.network],
  );

  useEffect(() => () => linkRef.current?.close(), []);

  const sendEmergency = useCallback((): Delivery | null => {
    const alert = makeAlert('emergency', 'Emergency alert raised from the speaker device');
    pushAlert(alert);
    return broadcastToCaregiver({ type: 'alert', alert });
  }, [broadcastToCaregiver, pushAlert]);

  const peer = useMemo<PeerLinkState>(() => {
    if (link) return toPeerLinkState(link);
    return isSimulated ? simulatedPeerAt(2) : toPeerLinkState(null);
  }, [isSimulated, link]);

  // Pitch Mode without a microphone replays demo sentences through speech.worker and the real grammar engine,
  // so the AST output and its latency on screen are genuine.
  useEffect(() => {
    if (!isSimulated || backendOnline !== true) return;
    let index = 0;
    const next = () => {
      const tokens = DEMO_TOKEN_SCRIPT[index % DEMO_TOKEN_SCRIPT.length];
      index += 1;
      postSpeech({ type: 'tokens', tokens: [...tokens], final: true, source: 'demo', endOfUtterance: true });
    };
    next();
    const timer = window.setInterval(next, DEMO_SENTENCE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [backendOnline, isSimulated, postSpeech]);

  // Canned output only while the grammar server is unreachable, and labelled as such.
  const useCannedGrammar = grammar === null && isSimulated && backendOnline === false;
  const [cannedSeconds, setCannedSeconds] = useState(0);
  useEffect(() => {
    if (!useCannedGrammar) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setCannedSeconds((Date.now() - startedAt) / 1000), DEMO_SENTENCE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [useCannedGrammar]);
  const shownGrammar = grammar ?? (useCannedGrammar ? simulatedGrammarAt(cannedSeconds) : null);
  const shownGrammarSource: GrammarSource | null = useCannedGrammar ? 'simulated' : grammarSource;

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
      grammarSource: shownGrammarSource,
      grammarRoundTripMs: useCannedGrammar ? null : grammarRoundTripMs,
      astBudgetMs,
      grammarError,
      grammarBusy,
      refinement: refinement && refinement.grammar === shownGrammar ? refinement : null,
      geminiAnswer,
      setGeminiAnswer,
      interimTokens,
      submitTokens,
      tokenSourceKind,
      setTokenSourceKind,
      dictationAvailable,
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
      remoteTranscripts,
      sendEmergency,
      lastMatch,
      lastAction,
      backendOnline,
      warning,
      recordSession,
      getSessionLog,
      startNewSession,
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
      shownGrammarSource,
      useCannedGrammar,
      grammarRoundTripMs,
      astBudgetMs,
      grammarError,
      grammarBusy,
      refinement,
      geminiAnswer,
      setGeminiAnswer,
      interimTokens,
      submitTokens,
      tokenSourceKind,
      dictationAvailable,
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
      remoteTranscripts,
      sendEmergency,
      lastMatch,
      lastAction,
      backendOnline,
      warning,
      recordSession,
      getSessionLog,
      startNewSession,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
