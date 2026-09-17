'use client';

import { useEffect, useRef, type MouseEvent } from 'react';
import { animate, createTimeline } from 'animejs';
import { AudioLines, Fingerprint, Radio, Shuffle, Waves, Zap, type LucideIcon } from 'lucide-react';
import { revealOnScroll } from '@/lib/motion';

interface Feature {
  icon: LucideIcon;
  title: string;
  text: string;
}

const FEATURES: Feature[] = [
  { icon: Shuffle, title: 'ClearVoice', text: 'On-device recognition writes down exactly what you said, stutters included, then grammar rules (and optionally Gemini) tidy it. You choose which gets typed.' },
  { icon: Waves, title: 'Fluency Coach', text: 'Delayed and frequency-shifted auditory feedback from an AudioWorklet, adjustable live from 30 to 150 ms.' },
  { icon: Fingerprint, title: 'Gesture Trainer', text: 'A hum, click or pitch rise becomes a 128-bin fingerprint that types a phrase, speaks it, alerts a caregiver or presses keys.' },
  { icon: AudioLines, title: 'Therapy and Sensory HUD', text: 'LPC formants place your vowels on a live F1/F2 plane; jitter, shimmer and HNR flag strain before it hurts.' },
  { icon: Radio, title: 'Caregiver link', text: 'Approved caregivers only. Readings and alerts travel peer to peer over WebRTC, and your phone can raise an alert too.' },
  { icon: Zap, title: 'Direct OS integration', text: 'What you say is typed into whatever app has focus, even while minimised, and gestures can press keyboard shortcuts.' },
];

const MAX_TILT_DEG = 9;

function TiltCard({ icon: Icon, title, text }: Feature) {
  const card = useRef<HTMLLIElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const running = useRef<ReturnType<typeof animate> | null>(null);

  const onMove = (event: MouseEvent<HTMLLIElement>) => {
    const element = card.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    running.current?.pause();
    running.current = animate(element, {
      rotateY: px * MAX_TILT_DEG * 2,
      rotateX: -py * MAX_TILT_DEG * 2,
      duration: 260,
      ease: 'outQuad',
    });
    if (glow.current) {
      glow.current.style.background = `radial-gradient(240px circle at ${(px + 0.5) * 100}% ${(py + 0.5) * 100}%, rgba(255,102,0,0.22), transparent 70%)`;
    }
  };

  const onEnter = () => {
    const element = card.current;
    const halo = glow.current;
    if (!element || !halo) return;
    createTimeline({ defaults: { ease: 'outCubic' } })
      .add(element, { scale: 1.025, duration: 260 }, 0)
      .add(element, { boxShadow: ['0 0 0 1px rgba(255,255,255,0.08)', '0 0 0 1px rgba(255,102,0,0.6), 0 0 36px -8px rgba(255,51,51,0.6)'], duration: 420 }, 0)
      .add(halo, { opacity: [0, 1], duration: 300 }, 0);
  };

  const onLeave = () => {
    const element = card.current;
    const halo = glow.current;
    if (!element || !halo) return;
    running.current?.pause();
    createTimeline({ defaults: { ease: 'outExpo' } })
      .add(element, { rotateX: 0, rotateY: 0, scale: 1, duration: 600 }, 0)
      .add(element, { boxShadow: '0 0 0 1px rgba(255,255,255,0.08)', duration: 500 }, 0)
      .add(halo, { opacity: 0, duration: 300 }, 0);
  };

  return (
    <li
      ref={card}
      onMouseMove={onMove}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ transformStyle: 'preserve-3d', boxShadow: '0 0 0 1px rgba(255,255,255,0.08)' }}
      className="feature-card relative overflow-hidden rounded-2xl bg-onyx p-6 opacity-0 will-change-transform"
    >
      <div ref={glow} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" />
      <span className="grid size-11 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
        <Icon aria-hidden className="size-5 text-ember" />
      </span>
      <h3 className="mt-4 font-display text-lg font-semibold text-bone">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-smoke">{text}</p>
    </li>
  );
}

export function Features() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current;
    if (!section) return;
    const reveal = revealOnScroll('.feature-card', section, { step: 70 });
    return () => {
      reveal?.revert();
    };
  }, []);

  return (
    <section ref={root} id="features" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <h2 className="max-w-2xl font-display text-3xl font-bold text-bone sm:text-4xl">Six modes, one pipeline on your machine</h2>
      <p className="mt-3 max-w-2xl text-smoke">Pick the profile that fits how you speak. Every one of them runs on your machine.</p>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ perspective: '1200px' }}>
        {FEATURES.map((feature) => (
          <TiltCard key={feature.title} {...feature} />
        ))}
      </ul>
    </section>
  );
}
