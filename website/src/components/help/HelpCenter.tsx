'use client';

/** Every help answer on one page: search, jump to a topic, open any answer. The same data as the Help button. */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, CircleHelp, Search, X } from 'lucide-react';
import { HELP, HELP_ANSWER_COUNT, HELP_TOPICS, searchHelp, type HelpNode } from '@/lib/help/guide';

function Answer({ node, open, onToggle }: { node: HelpNode; open: boolean; onToggle: () => void }) {
  return (
    <li id={node.id} className="scroll-mt-28 rounded-2xl border border-white/10 bg-onyx/70 transition hover:border-white/20">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${node.id}-answer`} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <span className="font-display font-semibold text-bone">{node.title}</span>
        <ChevronDown aria-hidden className={`size-5 shrink-0 text-smoke transition-transform ${open ? 'rotate-180 text-ember' : ''}`} />
      </button>
      {open && (
        <div id={`${node.id}-answer`} className="space-y-3 border-t border-white/[0.06] px-5 pb-5 pt-4 text-bone/85">
          {node.answer?.map((paragraph, index) => (
            <p key={index} className="leading-relaxed">
              {paragraph}
            </p>
          ))}
          {node.link && (
            <Link href={node.link.href} className="inline-block text-sm font-semibold text-ember hover:underline">
              {node.link.label}
            </Link>
          )}
          {node.options && node.options.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {node.options.map((option) => (
                <a key={option.to} href={`#${option.to}`} className="rounded-full border border-white/10 px-3 py-1 text-xs text-smoke hover:border-ember/50 hover:text-bone">
                  {option.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function HelpCenter() {
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const results = useMemo(() => (query.trim().length > 1 ? searchHelp(query, 20) : null), [query]);

  // A link to /help#some-answer opens that answer.
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && HELP.get(id)?.answer) {
        setQuery('');
        setOpenIds((current) => new Set(current).add(id));
        window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="sticky top-16 z-20 -mx-6 bg-obsidian/90 px-6 py-4 backdrop-blur">
        <div className="relative mx-auto max-w-3xl">
          <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-smoke" />
          <label htmlFor="help-search" className="sr-only">
            Search {HELP_ANSWER_COUNT} answers
          </label>
          <input
            id="help-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${HELP_ANSWER_COUNT} answers: "direct paste", "approve a caregiver", "keybinds"…`}
            className="field h-14 rounded-2xl pl-12 pr-12 text-lg"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-smoke hover:bg-white/10 hover:text-bone">
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </div>

      {results ? (
        <section aria-live="polite" className="mx-auto mt-6 max-w-3xl">
          <p className="text-sm text-smoke">{results.length === 0 ? `Nothing matches “${query.trim()}”. Try fewer words, or browse the topics.` : `${results.length} best matches`}</p>
          <ul className="mt-4 space-y-3">
            {results.map((node) => (
              <Answer key={node.id} node={node} open={openIds.has(node.id)} onToggle={() => toggle(node.id)} />
            ))}
          </ul>
        </section>
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Topics" className="lg:sticky lg:top-40 lg:h-fit">
            <p className="text-xs font-bold uppercase tracking-wider text-smoke">Topics</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {HELP_TOPICS.map((topic) => (
                <li key={topic.id}>
                  <a href={`#topic-${topic.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-smoke hover:bg-white/[0.05] hover:text-bone">
                    {topic.title}
                    <span className="text-xs tabular-nums text-smoke/70">{topic.nodes.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="space-y-14">
            {HELP_TOPICS.map((topic) => (
              <section key={topic.id} id={`topic-${topic.id}`} aria-labelledby={`topic-${topic.id}-heading`} className="scroll-mt-40">
                <h2 id={`topic-${topic.id}-heading`} className="font-display text-2xl font-bold text-bone">
                  {topic.title}
                </h2>
                <p className="mt-1 text-smoke">{topic.summary}</p>
                <ul className="mt-5 space-y-3">
                  {topic.nodes.map((node) => (
                    <Answer key={node.id} node={HELP.get(node.id)!} open={openIds.has(node.id)} onToggle={() => toggle(node.id)} />
                  ))}
                </ul>
              </section>
            ))}
            <p className="flex items-center gap-2 rounded-2xl border border-white/10 bg-onyx/70 p-5 text-sm text-smoke">
              <CircleHelp aria-hidden className="size-5 shrink-0 text-ember" />
              Every answer here is written by the Voicematics team and searched on your device. Nothing you type is sent anywhere, and no AI is involved.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
