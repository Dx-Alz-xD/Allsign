'use client';

import { useId, useState, type FormEvent } from 'react';
import { ClipboardPaste, Mic, MicOff, Send, TriangleAlert } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { Switch, inputStyles } from '@/components/modals/settings/controls';
import { useSession } from '@/components/providers/SessionProvider';
import { SyntaxTree, TextReconstruction } from '@/components/ui/Reconstruction';
import { tokenize } from '@/lib/speech/tokenSource';

/**
 * Speech tokens in, grammatical sentence out, typed into the active app.
 * Tokens come from the text box (always) or system dictation (opt-in, where
 * the platform offers it); see lib/speech/tokenSource.ts for why.
 */
export function TokenInput({ compact = false }: { compact?: boolean }) {
  const { submitTokens, grammarBusy, grammarError, dictationAvailable, dictationActive, setDictationActive, interimTokens, backendOnline } = useSession();
  const [text, setText] = useState('');
  const inputId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const tokens = tokenize(text);
    if (tokens.length === 0) return;
    void submitTokens(tokens).then((response) => {
      if (response) setText('');
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-bold text-mist">
        {compact ? 'Words as they were said' : 'Type or paste the words as they were said, fillers and repeats included'}
      </label>
      <textarea
        id={inputId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={compact ? 2 : 3}
        placeholder="um me w-w-water want"
        className={inputStyles}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={grammarBusy || backendOnline === false} className={buttonStyles.primary}>
          <Send aria-hidden className="size-4" />
          {grammarBusy ? 'Rebuilding' : 'Rebuild sentence'}
        </button>
        {dictationAvailable && (
          <button
            type="button"
            onClick={() => setDictationActive(!dictationActive)}
            className={buttonStyles.secondary}
            aria-pressed={dictationActive}
          >
            {dictationActive ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
            {dictationActive ? 'Stop system dictation' : 'Use system dictation'}
          </button>
        )}
        {dictationAvailable && (
          <span className="text-sm text-mist">
            System dictation hands audio to your browser vendor&apos;s recognizer, outside OmniVoice&apos;s no-model guarantee.
          </span>
        )}
      </div>
      {interimTokens.length > 0 && (
        <p className="text-sm text-mist">
          Hearing: <span className="text-ink">{interimTokens.join(' ')}</span>
        </p>
      )}
      {grammarError && (
        <p role="alert" className="flex items-start gap-2 text-sm text-warn">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {grammarError}
        </p>
      )}
    </form>
  );
}

export function DirectPasteControls() {
  const { directPasteActive, setDirectPasteActive, grammar, typeText, lastPasteDetail } = useSession();
  const inDesktop = typeof window !== 'undefined' && Boolean(window.omnivoice);
  const describedBy = useId();

  return (
    <div className="flex flex-col gap-3">
      <Switch checked={directPasteActive} onChange={setDirectPasteActive} label="Direct paste" describedBy={describedBy} />
      <p id={describedBy} className="text-sm text-mist">
        {inDesktop
          ? 'When on, every rebuilt sentence is typed into whichever app has keyboard focus.'
          : 'Direct paste needs the desktop app; in a browser the sentence stays here.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => grammar && void typeText(grammar.formattedText)}
          disabled={!grammar || !inDesktop}
          className={buttonStyles.secondary}
        >
          <ClipboardPaste aria-hidden className="size-4" />
          Type the last sentence now
        </button>
        {lastPasteDetail && <span className="text-sm text-mist">{lastPasteDetail}</span>}
      </div>
    </div>
  );
}

export function ClearVoicePanel() {
  const { grammar } = useSession();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section aria-label="Sentence reconstruction" className="glass flex flex-col gap-5 rounded-2xl p-5">
        <TokenInput />
        <TextReconstruction grammar={grammar} />
      </section>
      <div className="flex flex-col gap-4">
        <section aria-label="Direct paste" className="glass rounded-2xl p-5">
          <DirectPasteControls />
        </section>
        <section aria-label="Syntax tree" className="glass flex flex-col gap-3 rounded-2xl p-5">
          <h3 className="text-base font-semibold text-ink">Syntax tree</h3>
          {grammar ? <SyntaxTree tree={grammar.parsedTree} /> : <p className="text-mist">The tree appears after the first sentence is rebuilt.</p>}
        </section>
      </div>
    </div>
  );
}
