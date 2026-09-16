'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import {
  EMPTY_SIGN_MANIFEST,
  loadSignManifest,
  signAssetUrl,
  signHoldMs,
  signTokens,
  type SignManifest,
  type SignToken,
} from '@/lib/signs/manifest';
import { cn } from '@/lib/cn';

/**
 * Word-by-word sign sequence for a reconstructed sentence. The overlay on the
 * spectrogram and the strip under the sentence read the same playback state,
 * so they always show the same word; each sign holds for one word at the
 * speaker's current rate.
 */
export interface SignPlayback {
  manifest: SignManifest;
  /** Signed words of the sentence; articles and forms of "be" are skipped. */
  tokens: SignToken[];
  /** Position in `tokens`, or -1 when there is nothing to show. */
  index: number;
  current: SignToken | null;
  playing: boolean;
  finished: boolean;
  play: () => void;
  pause: () => void;
  replay: () => void;
}

export function useSignManifest(): SignManifest {
  const [manifest, setManifest] = useState<SignManifest>(EMPTY_SIGN_MANIFEST);
  useEffect(() => {
    let cancelled = false;
    void loadSignManifest().then((loaded) => {
      if (!cancelled) setManifest(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return manifest;
}

export function useSignPlayback(sentence: string | null, wordsPerMinute: number): SignPlayback {
  const manifest = useSignManifest();
  const tokens = useMemo(
    () => (sentence ? signTokens(sentence, manifest).filter((token) => token.signed) : []),
    [manifest, sentence],
  );

  // Read at each step, so a changing speaking rate retimes the sequence without restarting it.
  const holdRef = useRef(signHoldMs(wordsPerMinute));
  holdRef.current = signHoldMs(wordsPerMinute);

  const [position, setPosition] = useState({ sentence, index: 0 });
  const [playing, setPlaying] = useState(true);
  if (position.sentence !== sentence) {
    // A new sentence starts from its first sign.
    setPosition({ sentence, index: 0 });
    setPlaying(true);
  }

  const index = tokens.length === 0 ? -1 : Math.min(position.index, tokens.length - 1);
  const finished = tokens.length > 0 && index === tokens.length - 1;

  useEffect(() => {
    if (!playing || finished || index < 0) return;
    const timer = window.setTimeout(() => {
      setPosition((current) => (current.sentence === sentence ? { sentence, index: current.index + 1 } : current));
    }, holdRef.current);
    return () => window.clearTimeout(timer);
  }, [finished, index, playing, sentence]);

  return {
    manifest,
    tokens,
    index,
    current: index >= 0 ? tokens[index] : null,
    playing: playing && !finished,
    finished,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    replay: () => {
      setPosition({ sentence, index: 0 });
      setPlaying(true);
    },
  };
}

function SignImage({ token, className }: { token: SignToken; className?: string }) {
  const src = token.entry && typeof document !== 'undefined' ? signAssetUrl(token.entry.image, document.baseURI) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && token.entry && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={token.entry.alt}
        onError={() => setFailedSrc(src)}
        className={cn('aspect-square w-full rounded-lg bg-black object-contain', className)}
      />
    );
  }

  // Never a guessed sign: a word without a usable photo says so.
  return (
    <div
      className={cn(
        'grid aspect-square w-full place-items-center rounded-lg border border-dashed border-white/25 bg-white/[0.03] p-1 text-center',
        className,
      )}
    >
      <span className="text-xs font-bold leading-tight text-mist">No photo yet</span>
    </div>
  );
}

/** The current sign, over the live spectrogram. Decorative duplicate of SignStrip, so hidden from screen readers. */
export function SignOverlay({ playback, className }: { playback: SignPlayback; className?: string }) {
  const { current, manifest } = playback;
  if (!current) return null;
  return (
    <div
      aria-hidden
      data-sign-overlay={current.key}
      className={cn('pointer-events-none w-28 rounded-xl border border-neon-cyan/50 bg-void/85 p-1.5 shadow-neon-soft', className)}
    >
      <SignImage token={current} />
      <p className="mt-1 truncate text-center font-display text-sm font-semibold text-ink">{current.display}</p>
      {manifest.language && <p className="text-center text-xs text-mist">{manifest.language}</p>}
    </div>
  );
}

export function SignStrip({ playback }: { playback: SignPlayback }) {
  const { tokens, index, current, playing, finished, manifest, play, pause, replay } = playback;
  const headingId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const hasPhotos = Object.keys(manifest.signs).length > 0;

  useEffect(() => {
    if (index < 0) return;
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [index]);

  const control = finished
    ? { label: 'Replay signs', icon: RotateCcw, action: replay }
    : playing
      ? { label: 'Pause signs', icon: Pause, action: pause }
      : { label: 'Play signs', icon: Play, action: play };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold text-ink">
          Signs{manifest.language ? ` (${manifest.language})` : ''}
        </h3>
        {tokens.length > 0 && (
          <button type="button" onClick={control.action} className={cn(buttonStyles.secondary, 'h-9 px-3 text-sm')}>
            <control.icon aria-hidden className="size-4" />
            {control.label}
          </button>
        )}
      </div>

      {tokens.length === 0 ? (
        <p className="text-mist">A sign for each word appears here after a sentence is rebuilt.</p>
      ) : (
        <ol ref={listRef} className="flex gap-2 overflow-x-auto pb-1">
          {tokens.map((token, position) => (
            <li
              key={`${token.index}-${token.key}`}
              aria-current={position === index ? 'step' : undefined}
              className={cn(
                'w-20 shrink-0 rounded-xl border p-1.5 transition-colors motion-reduce:transition-none',
                position === index ? 'border-neon-cyan bg-neon-cyan/[0.08]' : 'border-white/10',
              )}
            >
              <SignImage token={token} />
              <p className="mt-1 truncate text-center text-sm font-semibold text-ink">{token.display}</p>
            </li>
          ))}
        </ol>
      )}

      <p className="text-sm text-mist">
        {!hasPhotos
          ? 'No sign photos are installed yet, so each word shows a text card instead of a guessed sign.'
          : current?.entry?.credit
            ? `Photo: ${current.entry.credit}`
            : manifest.attribution}
      </p>
    </section>
  );
}
