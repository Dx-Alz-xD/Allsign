'use client';

import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import type { PhonemeLookupResponse } from '@shared/types';
import { TokenInput } from '@/components/profiles/ClearVoicePanel';
import { useSession } from '@/components/providers/SessionProvider';
import { TextReconstruction } from '@/components/ui/Reconstruction';
import { inputStyles } from '@/components/modals/settings/controls';
import { api, ApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';

const LOOKUP_DEBOUNCE_MS = 250;

/** Word-finding cues from the phoneme trie, next to sentence reconstruction. */
function WordFinder() {
  const { backendOnline } = useSession();
  const [prefix, setPrefix] = useState('');
  const [result, setResult] = useState<PhonemeLookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (!backendOnline) return;
    const timer = window.setTimeout(() => {
      api.phonemes
        .lookup(prefix, 12)
        .then((response) => {
          setResult(response);
          setError(null);
        })
        .catch((cause: unknown) => {
          setResult(null);
          setError(cause instanceof ApiError && typeof cause.detail === 'string' ? cause.detail : 'Lookup failed.');
        });
    }, LOOKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [backendOnline, prefix]);

  const extend = (phoneme: string) => setPrefix((current) => (current.trim() ? `${current.trim()} ${phoneme}` : phoneme));

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-bold text-mist">
        Sounds you can get out, as ARPAbet phonemes (for example <code className="text-ink">W AO</code> for &ldquo;wa&hellip;&rdquo;)
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
        <input id={inputId} value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="W AO" className={cn(inputStyles, 'pl-9')} />
      </div>
      {error && <p className="text-sm text-warn">{error}</p>}
      {!backendOnline && <p className="text-sm text-mist">Word cues need the backend and its seeded dictionary.</p>}
      {result && backendOnline && (
        <div className="flex flex-col gap-3">
          {result.found ? (
            <>
              <p className="text-sm text-mist">
                {result.wordCount.toLocaleString()} word{result.wordCount === 1 ? '' : 's'} start this way.
              </p>
              {result.words.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Likely words">
                  {result.words.map((word) => (
                    <li key={`${word.word}-${word.arpabet}`} className="rounded-lg bg-neon-cyan/10 px-3 py-1.5 ring-1 ring-neon-cyan/30">
                      <span className="font-display text-lg font-semibold text-ink">{word.word}</span>
                      <span className="ml-2 text-xs text-mist">{word.arpabet}</span>
                    </li>
                  ))}
                </ul>
              )}
              {result.next.length > 0 && (
                <div>
                  <p className="text-sm text-mist">Next sound could be</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Next phonemes">
                    {result.next.map((branch) => (
                      <li key={branch.phoneme}>
                        <button type="button" onClick={() => extend(branch.phoneme)} className="rounded-lg border border-white/15 px-2.5 py-1 text-sm text-ink hover:bg-white/10">
                          {branch.phoneme}
                          {branch.topWord && <span className="ml-1.5 text-mist">{branch.topWord}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-mist">
              {prefix.trim() ? 'No word in the dictionary starts with those sounds.' : 'The dictionary is not seeded yet; run backend/scripts/kaggle_sync.py.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AphasiaPanel() {
  const { grammar } = useSession();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-label="Word finding" className="glass flex flex-col gap-4 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-ink">Word finding</h3>
        <WordFinder />
      </section>
      <section aria-label="Sentence building" className="glass flex flex-col gap-5 rounded-2xl p-5">
        <h3 className="text-base font-semibold text-ink">Sentence building</h3>
        <TokenInput compact />
        <TextReconstruction grammar={grammar} />
      </section>
    </div>
  );
}
