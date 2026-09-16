'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Timer } from 'lucide-react';
import type { GrammarResponse } from '@shared/types';
import type { GrammarSource } from '@/components/providers/SessionProvider';
import { DISFLUENCY_LABELS, classifyToken } from '@/lib/hud/disfluency';
import { describeTag, parseBracketedTree, type SyntaxNode } from '@/lib/hud/syntaxTree';
import { cn } from '@/lib/cn';

const SOURCE_LABELS: Record<GrammarSource, string> = {
  manual: 'Typed',
  'system-dictation': 'Dictated',
  demo: 'Demo sentence, parsed live by the grammar server',
  simulated: 'Simulated: the grammar server is offline',
};

interface TextReconstructionProps {
  grammar: GrammarResponse | null;
  /** speech.worker request start to parsed response. */
  roundTripMs?: number | null;
  /** The grammar engine's parse budget; shows whether this parse met it. */
  budgetMs?: number;
  source?: GrammarSource | null;
}

export function TextReconstruction({ grammar, roundTripMs = null, budgetMs, source = null }: TextReconstructionProps) {
  if (!grammar) {
    return <p className="text-mist">Reconstructed sentences appear here as you speak.</p>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={grammar.formattedText}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-2.5">
          <h3 className="text-base font-semibold text-ink">What was heard</h3>
          <ul className="flex flex-wrap gap-2">
            {grammar.originalTokens.map((token, index) => {
              const kind = classifyToken(grammar.originalTokens, index);
              return (
                <li
                  key={`${index}-${token}`}
                  className={cn(
                    'rounded-lg px-2.5 py-1 font-display text-base',
                    kind ? 'border border-dashed border-warn/60 text-warn' : 'bg-white/[0.06] text-ink ring-1 ring-white/10',
                  )}
                >
                  {token}
                  {kind && <span className="sr-only"> ({DISFLUENCY_LABELS[kind]})</span>}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-mist">Dashed words are repetitions or fillers the grammar rules remove.</p>
        </div>

        <div className="flex flex-col gap-2.5">
          <h3 className="text-base font-semibold text-ink">Reconstructed sentence</h3>
          <p className="rounded-xl border border-neon-cyan/30 bg-neon-cyan/[0.06] px-4 py-3 font-display text-2xl font-semibold leading-snug text-ink sm:text-3xl">
            {grammar.formattedText}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mist">
            <span className="flex items-center gap-1.5">
              <Timer aria-hidden className="size-4" />
              Parsed in <span className="tabular-nums">{grammar.executionLatencyMs.toFixed(1)} ms</span>
            </span>
            {budgetMs !== undefined && source !== 'simulated' && (
              <span data-ast-budget className={grammar.executionLatencyMs <= budgetMs ? 'text-neon-cyan' : 'text-warn'}>
                {grammar.executionLatencyMs <= budgetMs ? `within the ${budgetMs} ms budget` : `over the ${budgetMs} ms budget`}
              </span>
            )}
            {roundTripMs !== null && <span className="tabular-nums">{roundTripMs.toFixed(1)} ms round trip</span>}
            {source && <span>{SOURCE_LABELS[source]}</span>}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export function SyntaxTree({ tree }: { tree: string }) {
  const root = useMemo(() => parseBracketedTree(tree), [tree]);

  if (!root) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-3 text-sm text-mist">
        {tree}
      </pre>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.ul
        key={tree}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        aria-label="Syntax tree"
        className="overflow-x-auto rounded-xl bg-black/25 p-3 text-[0.95rem] ring-1 ring-white/10"
      >
        <TreeItem node={root} isRoot />
      </motion.ul>
    </AnimatePresence>
  );
}

function TreeItem({ node, isRoot = false }: { node: SyntaxNode; isRoot?: boolean }) {
  const branch =
    !isRoot &&
    'relative pl-5 before:absolute before:left-1.5 before:top-0 before:h-full before:border-l before:border-white/20 after:absolute after:left-1.5 after:top-[0.85rem] after:w-2.5 after:border-t after:border-white/20 last:before:h-[0.85rem]';

  if (node.children.length === 0) {
    return (
      <li className={cn(branch)}>
        <span className="font-semibold text-neon-cyan">{node.label}</span>
      </li>
    );
  }

  const tagName = describeTag(node.label);
  const tag = (
    <abbr title={tagName} className={cn('font-display font-semibold text-mist no-underline', tagName && 'cursor-help')}>
      {node.label}
    </abbr>
  );
  const [firstChild] = node.children;
  const isPreterminal = node.children.length === 1 && firstChild.children.length === 0;

  return (
    <li className={cn(branch, 'py-0.5')}>
      {isPreterminal ? (
        <span className="inline-flex items-baseline gap-2">
          {tag}
          <span className="font-semibold text-neon-cyan">{firstChild.label}</span>
        </span>
      ) : (
        <>
          {tag}
          <ul>
            {node.children.map((child, index) => (
              <TreeItem key={`${index}-${child.label}`} node={child} />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}
