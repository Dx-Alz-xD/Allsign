'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell, MessageSquareText, MonitorSmartphone, Radio } from 'lucide-react';
import { revealOnScroll } from '@/lib/motion';

const POINTS = [
  { icon: MonitorSmartphone, text: 'Nothing to install and no account. Open the link the speaker sends you, on a phone or a laptop.' },
  { icon: Radio, text: 'Voice readings, blocks and strain arrive live from their computer over a direct connection.' },
  { icon: Bell, text: 'Emergency and strain alerts sound in your browser and can notify you when the tab is hidden.' },
  { icon: MessageSquareText, text: 'Every sentence the app rebuilds shows up as they say it.' },
];

export function ForCaregivers() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = root.current;
    if (!section) return;
    const reveal = revealOnScroll('.caregiver-point', section, { step: 90 });
    return () => {
      reveal?.revert();
    };
  }, []);

  return (
    <section ref={root} id="caregivers" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="grid gap-10 rounded-3xl border border-white/10 bg-onyx/70 p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:p-12">
        <div>
          <h2 className="max-w-xl font-display text-3xl font-bold text-bone sm:text-4xl">For the people who look after them</h2>
          <p className="mt-4 max-w-xl text-smoke">
            Caregivers, family and clinicians watch from the browser. The speaker opens Caregiver Link in the desktop app and shares a room code or a link; that
            is all it takes.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/caregiver" className="btn-primary">
              Open the caregiver console
            </Link>
          </div>
        </div>
        <ul className="space-y-4">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="caregiver-point flex items-start gap-3 opacity-0">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ember/10 ring-1 ring-ember/40">
                <Icon aria-hidden className="size-4 text-ember" />
              </span>
              <span className="text-smoke">{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
