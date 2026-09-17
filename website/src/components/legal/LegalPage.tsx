import type { ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

interface LegalPageProps {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  updated: string;
  highlights: { icon: LucideIcon; title: string; text: string }[];
  sections: LegalSection[];
  related: { href: string; label: string };
}

/** Terms and privacy: a plain-language summary first, then the full text with a table of contents beside it. */
export function LegalPage({ eyebrow, title, intro, updated, highlights, sections, related }: LegalPageProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 pb-10 pt-28">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-wider text-ember">{eyebrow}</p>
        <h1 className="mt-2 font-display text-4xl font-bold text-bone sm:text-5xl">{title}</h1>
        <div className="mt-4 text-lg text-smoke">{intro}</div>
        <p className="mt-3 text-sm text-smoke">Last updated {updated}.</p>
      </header>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {highlights.map(({ icon: Icon, title: heading, text }) => (
          <li key={heading} className="rounded-2xl border border-white/10 bg-onyx/80 p-5">
            <span className="grid size-9 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
              <Icon aria-hidden className="size-4 text-ember" />
            </span>
            <p className="mt-3 font-display font-semibold text-bone">{heading}</p>
            <p className="mt-1 text-sm text-smoke">{text}</p>
          </li>
        ))}
      </ul>

      <div className="mt-14 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:h-fit">
          <p className="text-xs font-bold uppercase tracking-wider text-smoke">On this page</p>
          <ol className="mt-3 space-y-2 border-l border-white/10 text-sm">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="-ml-px block border-l border-transparent pl-4 text-smoke hover:border-ember hover:text-bone">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
          <Link href={related.href} className="mt-6 block text-sm text-ember hover:underline">
            {related.label}
          </Link>
        </nav>
        <article className="max-w-3xl space-y-12">
          {sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24">
              <h2 id={`${section.id}-heading`} className="font-display text-2xl font-semibold text-bone">
                {section.title}
              </h2>
              <div className="legal-body mt-4 space-y-4 leading-relaxed text-bone/85">{section.body}</div>
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
