'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell, MessageSquareText, MonitorSmartphone, Radio, ShieldCheck } from 'lucide-react';
import { revealOnScroll } from '@/lib/motion';

const POINTS = [
  { icon: ShieldCheck, text: 'Nobody watches with a room code alone. You sign in, and the speaker approves your username once; they can remove it any time.' },
  { icon: MonitorSmartphone, text: 'Nothing to install and no paid plan needed. Open the link the speaker sends you, on a phone or a laptop.' },
  { icon: Radio, text: 'Voice readings, blocks and strain arrive live from their computer over a direct connection.' },
  { icon: Bell, text: 'Emergency and strain alerts sound in your browser, including alerts the speaker sends from their phone.' },
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
            Caregivers, family and clinicians watch from the browser. The speaker shares a room code from the desktop app and approves the caregiver&apos;s
            username; from then on readings and alerts arrive live.
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
