'use client';

import { useId } from 'react';
import { Copy, Download, Ear, EarOff, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { useSession } from '@/components/providers/SessionProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { MODEL_LABELS } from '@/lib/speech/recognizer';
import type { RecognizerModel } from '@/lib/settings/schema';
import { cn } from '@/lib/cn';

const MODELS: RecognizerModel[] = ['tiny', 'base', 'small'];

/**
 * The on-device recognizer: start listening, watch the model load, pick its size. Everything it hears goes to
 * the grammar engine as words, and is kept verbatim in the raw transcript below.
 */
export function ListenControls() {
  const { listening, setListening, recognizer } = useSession();
  const { settings, updateSpeech } = useSettings();
  const modelId = useId();
  const loading = recognizer.status === 'loading';
  const percent = recognizer.progress.fraction === null ? null : Math.round(recognizer.progress.fraction * 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void setListening(!listening)} aria-pressed={listening} className={listening ? buttonStyles.secondary : buttonStyles.primary}>
          {listening ? <EarOff aria-hidden className="size-4" /> : <Ear aria-hidden className="size-4" />}
          {listening ? 'Stop listening' : 'Listen to my voice'}
        </button>
        <p className="flex items-center gap-2 text-sm text-mist" aria-live="polite">
          {loading && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
          {recognizer.status === 'off' && 'Recognition runs on this computer. Nothing you say is uploaded.'}
          {loading && (percent === null ? 'Preparing the speech model' : `Downloading the speech model, ${percent}% of ${recognizer.progress.totalMb.toFixed(0)} MB (first time only)`)}
          {recognizer.status === 'ready' && `Listening${recognizer.device === 'webgpu' ? ' on the graphics card' : ''}${recognizer.pending > 0 ? `, transcribing ${recognizer.pending}` : ''}`}
          {recognizer.status === 'error' && (
            <span className="flex items-start gap-1 text-warn">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {recognizer.error}
            </span>
          )}
        </p>
      </div>
      {loading && percent !== null && (
        <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="h-full rounded-full bg-neon-edge transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={modelId} className="text-sm font-bold text-mist">
          Accuracy
        </label>
        <div id={modelId} role="group" className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
          {MODELS.map((model) => (
            <button
              key={model}
              type="button"
              disabled={listening}
              onClick={() => updateSpeech({ recognizerModel: model })}
              aria-pressed={settings.speech.recognizerModel === model}
              title={MODEL_LABELS[model].detail}
              className={cn('h-8 rounded-lg px-3 text-sm font-semibold transition-colors', settings.speech.recognizerModel === model ? 'bg-white/10 text-ink' : 'text-mist hover:text-ink')}
            >
              {MODEL_LABELS[model].label}
            </button>
          ))}
        </div>
        <span className="text-sm text-mist">{MODEL_LABELS[settings.speech.recognizerModel].detail}. Stop listening to change it.</span>
      </div>
    </div>
  );
}

/** Every utterance as it was heard: stutters, repeats and fillers included. Nothing here is corrected. */
export function RawTranscript() {
  const { rawTranscript, clearRawTranscript } = useSession();
  const text = () => [...rawTranscript].reverse().map((entry) => `[${new Date(entry.at).toLocaleTimeString()}] ${entry.text}`).join('\n');

  const download = () => {
    const blob = new Blob([text()], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `voicematics-raw-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Heard, word for word</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(text())} disabled={rawTranscript.length === 0} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
            <Copy aria-hidden className="size-4" />
            Copy
          </button>
          <button type="button" onClick={download} disabled={rawTranscript.length === 0} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
            <Download aria-hidden className="size-4" />
            Save
          </button>
          <button type="button" onClick={clearRawTranscript} disabled={rawTranscript.length === 0} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
            <Trash2 aria-hidden className="size-4" />
            Clear
          </button>
        </div>
      </div>
      {rawTranscript.length === 0 ? (
        <p className="text-sm text-mist">Turn on listening and speak. What the recognizer hears is written here exactly, before the grammar rules touch it.</p>
      ) : (
        <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
          {rawTranscript.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-ink">{entry.text}</p>
              <p className="mt-0.5 text-xs text-mist">
                {new Date(entry.at).toLocaleTimeString()} · {(entry.durationMs / 1000).toFixed(1)} s of speech, transcribed in {(entry.decodeMs / 1000).toFixed(1)} s
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
