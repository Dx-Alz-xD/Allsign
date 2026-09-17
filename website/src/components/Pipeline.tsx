'use client';

import { useEffect, useRef } from 'react';
import { createTimeline, onScroll, svg } from 'animejs';
import { Braces, Mic, Radar, Send, type LucideIcon } from 'lucide-react';
import { reducedMotion } from '@/lib/motion';

interface Stage {
  icon: LucideIcon;
  title: string;
  text: string;
  /** Position along the path, 0..1. */
  at: number;
}

const STAGES: Stage[] = [
  { icon: Mic, title: 'Capture', text: '48 kHz in, 16 kHz out. An anti-alias filter and 10 ms chunks, all inside an AudioWorklet.', at: 0.06 },
  { icon: Radar, title: 'Analyse', text: 'FFT, YIN pitch, LPC formants, jitter, shimmer and HNR on every frame, in workers off the UI thread.', at: 0.36 },
  { icon: Braces, title: 'Hear and rebuild', text: 'On-device recognition writes down every word as said; a formal grammar then drops fillers and repeats and orders the sentence in under 10 ms.', at: 0.66 },
  { icon: Send, title: 'Deliver', text: 'Typed into the app you are using, spoken aloud, or sent to a caregiver over a direct peer connection.', at: 0.96 },
];

// The signal's route across the section, in the SVG's own units.
const PATH = 'M 40 150 C 200 150, 240 40, 400 60 S 620 190, 780 140 S 1000 30, 1160 70';

/**
 * How a sound becomes a sentence. The route draws itself as the visitor scrolls, a packet rides along it,
 * and each stage lights when the packet reaches it. Scroll is the timeline, so reading speed sets the pace.
 */
export function Pipeline() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current;
    if (!section) return;
    const path = section.querySelector<SVGPathElement>('.pipeline-path');
    const packet = section.querySelector<SVGElement>('.pipeline-packet');
    const stages = Array.from(section.querySelectorAll<HTMLElement>('.pipeline-stage'));
    if (!path || !packet) return;

    if (reducedMotion()) {
      stages.forEach((stage) => stage.classList.add('is-lit'));
      packet.style.opacity = '0';
      return;
    }

    const [drawable] = svg.createDrawable(path);
    const motionPath = svg.createMotionPath(path);
    const story = createTimeline({
      // Thresholds read 'container target': the story starts when the section's top reaches 80% down the
      // viewport and ends when its bottom reaches 55%.
      autoplay: onScroll({ target: section, enter: '80% top', leave: '55% bottom', sync: true }),
      defaults: { ease: 'linear' },
    })
      .add(drawable, { draw: ['0 0', '0 1'], duration: 1000 }, 0)
      .add(packet, { translateX: motionPath.translateX, translateY: motionPath.translateY, duration: 1000 }, 0)
      .add(packet, { opacity: [0, 1], duration: 40 }, 0);
    stages.forEach((stage, index) => {
      story.add(stage, { opacity: [0.35, 1], y: [10, 0], duration: 120, ease: 'outCubic' }, Math.max(0, STAGES[index].at * 1000 - 60));
    });

    return () => {
      story.revert();
    };
  }, []);

  return (
    <section ref={root} id="pipeline" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
      <h2 className="max-w-2xl font-display text-3xl font-bold text-bone sm:text-4xl">How a sound becomes a sentence</h2>
      <p className="mt-3 max-w-2xl text-smoke">Four stages, one machine. Scroll to follow a frame of audio through the app.</p>

      <div className="relative mt-12">
        <svg viewBox="0 0 1200 220" aria-hidden className="hidden h-auto w-full lg:block">
          <path d={PATH} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="4 6" />
          <path className="pipeline-path" d={PATH} fill="none" stroke="url(#pipeline-stroke)" strokeWidth="3" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 8px rgba(255,102,0,0.6))' }} />
          <circle className="pipeline-packet" r="7" fill="#F2EDE6" style={{ filter: 'drop-shadow(0 0 10px #FF3333)', opacity: 0 }} />
          <defs>
            <linearGradient id="pipeline-stroke" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#FF3333" />
              <stop offset="1" stopColor="#FF6600" />
            </linearGradient>
          </defs>
        </svg>

        <ol className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <li key={stage.title} className="pipeline-stage rounded-2xl border border-white/10 bg-onyx/80 p-5 opacity-35 transition-[border-color,box-shadow] duration-500 [&.is-lit]:opacity-100">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
                    <Icon aria-hidden className="size-5 text-ember" />
                  </span>
                  <span className="font-display text-sm text-smoke">{index + 1} of {STAGES.length}</span>
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-bone">{stage.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-smoke">{stage.text}</p>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-6 max-w-2xl text-sm text-smoke">Only your account, plan and the settings you choose to save go to the Voicematics server. The audio and everything computed from it stay on the computer.</p>
    </section>
  );
}
