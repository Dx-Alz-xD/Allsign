'use client';

/**
 * Floating help guide: a walk through predefined questions, options and answers (lib/help/guide.ts). It runs
 * entirely in the visitor's browser; nothing is sent to a server and no model is involved.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { ArrowLeft, ChevronRight, CircleHelp, ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import { HELP, HELP_START, searchHelp, type HelpNode } from '@/lib/help/guide';
import { reducedMotion } from '@/lib/motion';

export function HelpGuide() {
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState<string[]>([HELP_START]);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const current = HELP.get(trail[trail.length - 1]) ?? HELP.get(HELP_START)!;
  const results = useMemo(() => searchHelp(query), [query]);
  const searching = query.trim().length > 1;

  useEffect(() => {
    if (open && panelRef.current && !reducedMotion()) {
      animate(panelRef.current, { opacity: [0, 1], y: [16, 0], scale: [0.96, 1], duration: 320, ease: 'outCubic' });
    }
  }, [open]);

  // Each step: the new node's text and choices rise in one after another, and the view starts at the top.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTo({ top: 0 });
    if (reducedMotion()) return;
    const items = body.querySelectorAll('[data-step]');
    if (items.length === 0) return;
    const run = animate(items, { opacity: [0, 1], y: [10, 0], duration: 260, delay: stagger(40), ease: 'outCubic' });
    return () => {
      run.revert();
    };
  }, [current.id, searching, results]);

  const go = (id: string) => {
    if (!HELP.has(id)) return;
    setQuery('');
    setTrail((steps) => [...steps, id]);
  };
  const back = () => setTrail((steps) => (steps.length > 1 ? steps.slice(0, -1) : steps));
  const restart = () => {
    setQuery('');
    setTrail([HELP_START]);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Voicematics help" className="flex h-[32rem] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-crimson/40 bg-obsidian shadow-ember">
          <header className="flex items-center gap-3 border-b border-white/10 bg-onyx px-4 py-3">
            <span className="grid size-9 place-items-center rounded-xl bg-crimson/15 ring-1 ring-crimson/60">
              <CircleHelp aria-hidden className="size-5 text-crimson" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold text-bone">Help</p>
              <p className="truncate text-xs text-smoke">Answers on this page, nothing sent anywhere</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="rounded-lg p-1 text-smoke hover:bg-white/10 hover:text-bone">
              <X aria-hidden className="size-4" />
            </button>
          </header>

          <label className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
            <Search aria-hidden className="size-4 shrink-0 text-smoke" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the answers"
              aria-label="Search the answers"
              className="min-w-0 flex-1 bg-transparent py-1 text-sm text-bone placeholder:text-smoke focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="rounded p-0.5 text-smoke hover:text-bone">
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </label>

          <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {searching ? (
              <SearchResults query={query} results={results} onPick={go} />
            ) : (
              <Step node={current} first={trail.length === 1} onPick={go} />
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-white/10 bg-onyx px-3 py-2">
            <button type="button" onClick={back} disabled={trail.length === 1 || searching} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-smoke hover:bg-white/10 hover:text-bone disabled:opacity-40 disabled:hover:bg-transparent">
              <ArrowLeft aria-hidden className="size-3.5" />
              Back
            </button>
            <button type="button" onClick={restart} disabled={trail.length === 1 && !searching} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-smoke hover:bg-white/10 hover:text-bone disabled:opacity-40 disabled:hover:bg-transparent">
              <RotateCcw aria-hidden className="size-3.5" />
              Start over
            </button>
          </footer>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Hide help' : 'Open help'}
        className="flex items-center gap-2 rounded-full border border-crimson/50 bg-obsidian px-4 py-3 font-display text-sm font-semibold text-bone shadow-ember transition hover:bg-onyx"
      >
        <CircleHelp aria-hidden className="size-4 text-crimson" />
        {open ? 'Close' : 'Help'}
      </button>
    </div>
  );
}

function Step({ node, first, onPick }: { node: HelpNode; first: boolean; onPick: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <h2 data-step className={`font-display font-semibold text-bone ${first ? 'text-lg' : 'text-base'}`}>
        {node.title}
      </h2>
      {node.answer?.map((paragraph, index) => (
        <p key={index} data-step className="text-sm leading-relaxed text-bone/90">
          {paragraph}
        </p>
      ))}
      {node.link && (
        <a data-step href={node.link.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ember hover:underline">
          {node.link.label}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
      {node.options && node.options.length > 0 && (
        <div className="space-y-2">
          {node.answer && (
            <p data-step className="pt-1 text-xs uppercase tracking-wide text-smoke">
              Related
            </p>
          )}
          {node.options.map((option) => (
            <OptionButton key={option.to} label={option.label} onClick={() => onPick(option.to)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({ query, results, onPick }: { query: string; results: HelpNode[]; onPick: (id: string) => void }) {
  if (results.length === 0) {
    return (
      <div className="space-y-3">
        <p data-step className="text-sm text-bone/90">
          Nothing matches &ldquo;{query.trim()}&rdquo;.
        </p>
        <p data-step className="text-sm text-smoke">
          Try a different word, or clear the search and pick a topic.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p data-step className="text-xs uppercase tracking-wide text-smoke">
        {results.length === 1 ? '1 answer' : `${results.length} answers`}
      </p>
      {results.map((node) => (
        <OptionButton key={node.id} label={node.title} onClick={() => onPick(node.id)} />
      ))}
    </div>
  );
}

function OptionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      data-step
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm text-bone transition hover:border-crimson/60 hover:bg-crimson/10"
    >
      <span>{label}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-smoke" />
    </button>
  );
}
