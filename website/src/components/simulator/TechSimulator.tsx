'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { animate, createTimeline, stagger } from 'animejs';
import { reducedMotion } from '@/lib/motion';
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
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mounted = useRef(false);

  // The incoming panel rises into place, its blocks a beat apart; the indicator slides to the chosen tab.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || reducedMotion()) return;
    const blocks = panel.querySelectorAll(':scope > div > *');
    const run = createTimeline({ defaults: { ease: 'outCubic' } })
      .add(panel, { opacity: [0, 1], duration: 260 }, 0)
      .add(blocks.length ? blocks : panel, { y: [18, 0], opacity: [0, 1], duration: 520, delay: stagger(70) }, 0);
    return () => {
      run.revert();
    };
  }, [active]);

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const tab = tabRefs.current[active];
    if (!indicator || !tab) return;
    const target = { left: tab.offsetLeft, top: tab.offsetTop, width: tab.offsetWidth, height: tab.offsetHeight };
    if (!mounted.current || reducedMotion()) {
      Object.assign(indicator.style, {
        transform: `translate(${target.left}px, ${target.top}px)`,
        width: `${target.width}px`,
        height: `${target.height}px`,
        opacity: '1',
      });
      mounted.current = true;
      return;
    }
    animate(indicator, { translateX: target.left, translateY: target.top, width: target.width, height: target.height, duration: 420, ease: 'outExpo' });
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
      <h2 className="max-w-2xl font-display text-3xl font-bold text-bone sm:text-4xl">Try each engine in the browser</h2>
      <p className="mt-3 max-w-2xl text-smoke">Everything below runs in this tab. The desktop app runs the same maths against your microphone.</p>

      <div role="tablist" aria-label="Technology simulator" onKeyDown={onKeyDown} className="relative mt-8 grid gap-2 sm:grid-cols-4">
        <span ref={indicatorRef} aria-hidden className="pointer-events-none absolute left-0 top-0 rounded-xl border border-ember/70 bg-ember/10 opacity-0 shadow-ember-soft" />
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
              className={`relative z-10 flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${selected ? 'border-transparent' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
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
