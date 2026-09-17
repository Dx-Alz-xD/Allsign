'use client';

/**
 * Diagnostic page for the on-device recognizer, outside the signed-in app: load a model, feed it a WAV file
 * or a live microphone utterance, and read back exactly what it heard. Open it at /dev/asr.
 */

import { useEffect, useRef, useState } from 'react';
import { Recognizer, type Recognition, type RecognizerState } from '@/lib/speech/recognizer';
import type { RecognizerModel } from '@/lib/settings/schema';
import { UtteranceRecorder } from '@/lib/speech/utteranceRecorder';

const TARGET_RATE = 16_000;

/** Decodes any audio file the browser can read into mono 16 kHz samples. */
async function decodeTo16k(file: File): Promise<Float32Array> {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await file.arrayBuffer());
  await context.close();
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_RATE), TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export default function AsrDiagnosticsPage() {
  const [model, setModel] = useState<RecognizerModel>('base');
  const [state, setState] = useState<RecognizerState | null>(null);
  const [results, setResults] = useState<Recognition[]>([]);
  const [note, setNote] = useState('');
  const recognizer = useRef<Recognizer | null>(null);
  const [micOn, setMicOn] = useState(false);
  const stopMic = useRef<(() => void) | null>(null);

  useEffect(() => () => recognizer.current?.stop(), []);

  const load = async () => {
    recognizer.current?.stop();
    const instance = new Recognizer({ onState: setState, onResult: (result) => setResults((current) => [result, ...current]) }, model);
    recognizer.current = instance;
    await instance.start(model);
  };

  const transcribeFile = async (file: File) => {
    const audio = await decodeTo16k(file);
    const id = recognizer.current?.transcribe(audio, Math.round((audio.length / TARGET_RATE) * 1000));
    setNote(id ? `Sent ${(audio.length / TARGET_RATE).toFixed(1)} s of audio as ${id}` : 'Load a model first.');
  };

  const toggleMic = async () => {
    if (micOn) {
      stopMic.current?.();
      stopMic.current = null;
      setMicOn(false);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const context = new AudioContext({ sampleRate: TARGET_RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(1024, 1, 1);
    const recorder = new UtteranceRecorder({
      onUtterance: (audio, durationMs) => {
        const id = recognizer.current?.transcribe(audio, durationMs);
        setNote(id ? `Utterance ${id}: ${(durationMs / 1000).toFixed(1)} s` : 'Load a model first.');
      },
    });
    processor.onaudioprocess = (event) => recorder.push(event.inputBuffer.getChannelData(0));
    source.connect(processor);
    processor.connect(context.destination);
    stopMic.current = () => {
      recorder.flush();
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    };
    setMicOn(true);
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-bold text-ink">On-device recognizer check</h1>
      <div className="flex flex-wrap items-center gap-3">
        <select value={model} onChange={(event) => setModel(event.target.value as RecognizerModel)} className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-ink">
          <option value="tiny">tiny</option>
          <option value="base">base</option>
          <option value="small">small</option>
        </select>
        <button type="button" onClick={() => void load()} className="rounded-lg bg-neon-cyan px-4 py-2 font-bold text-void">
          Load model
        </button>
        <span data-status className="text-sm text-mist">
          {state ? `${state.status}${state.device ? ` on ${state.device}` : ''}${state.progress.fraction !== null && state.status === 'loading' ? ` ${Math.round(state.progress.fraction * 100)}%` : ''}${state.error ? ` · ${state.error}` : ''}` : 'not loaded'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-mist">
          Audio file <input type="file" accept="audio/*" onChange={(event) => event.target.files?.[0] && void transcribeFile(event.target.files[0])} />
        </label>
        <button type="button" onClick={() => void toggleMic()} className="rounded-lg border border-white/20 px-4 py-2 text-ink">
          {micOn ? 'Stop microphone' : 'Use microphone'}
        </button>
        <span className="text-sm text-mist">{note}</span>
      </div>
      <ol data-results className="space-y-2">
        {results.map((result) => (
          <li key={result.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <p className="font-mono text-ink">{result.text || '(nothing)'}</p>
            <p className="text-xs text-mist">
              {result.id} · {(result.durationMs / 1000).toFixed(1)} s audio · decoded in {(result.decodeMs / 1000).toFixed(1)} s
            </p>
          </li>
        ))}
      </ol>
    </main>
  );
}
