'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { animate } from 'animejs';
import { AudioLines, Braces, Fingerprint, Waves, type LucideIcon } from 'lucide-react';
import { AcousticHudTab } from '@/components/simulator/AcousticHudTab';
import { AphasiaTab } from '@/components/simulator/AphasiaTab';
import { FluencyTab } from '@/components/simulator/FluencyTab';
import { VocalBridgeTab } from '@/components/simulator/VocalBridgeTab';

interface Tab {
  id: string;
  label: string;
  caption: string;
  icon: LucideIcon;
  render: () => JSX.Element;
}

const TABS: Tab[] = [
  { id: 'aphasia', label: 'Aphasia Assist', caption: 'Grammar reordering', icon: Braces, render: () => <AphasiaTab /> },
  { id: 'vocal-bridge', label: 'Vocal Bridge', caption: 'Acoustic triggers', icon: Fingerprint, render: () => <VocalBridgeTab /> },
  { id: 'fluency', label: 'Fluency Coach', caption: 'Auditory biofeedback', icon: Waves, render: () => <FluencyTab /> },
  { id: 'hud', label: 'Acoustic HUD', caption: 'Formant tracking', icon: AudioLines, render: () => <AcousticHudTab /> },
];

export function TechSimulator() {
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (panelRef.current) animate(panelRef.current, { opacity: [0, 1], y: [10, 0], duration: 360, ease: 'outCubic' });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (active + delta + TABS.length) % TABS.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const tab = TABS[active];

  return (
    <section id="simulator" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-ember">Live technology simulator</p>
      <h2 className="mt-3 font-display text-3xl font-bold text-bone sm:text-4xl">Try each engine in the browser</h2>
      <p className="mt-3 max-w-2xl text-smoke">Everything below runs in this tab. The desktop app runs the same maths against your microphone.</p>

      <div role="tablist" aria-label="Technology simulator" onKeyDown={onKeyDown} className="mt-8 grid gap-2 sm:grid-cols-4">
        {TABS.map(({ id, label, caption, icon: Icon }, index) => {
          const selected = index === active;
          return (
            <button
              key={id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              id={`tab-${id}`}
              aria-selected={selected}
              aria-controls={`panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${selected ? 'border-ember/70 bg-ember/10 shadow-ember-soft' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
            >
              <Icon aria-hidden className={`size-5 shrink-0 ${selected ? 'text-ember' : 'text-smoke'}`} />
              <span>
                <span className="block font-display text-sm font-semibold text-bone">{label}</span>
                <span className="block text-xs text-smoke">{caption}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div ref={panelRef} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} className="mt-6">
        {tab.render()}
      </div>
    </section>
  );
}
