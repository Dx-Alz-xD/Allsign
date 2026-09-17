'use client';

import { useEffect, useRef } from 'react';
import { animate, createTimeline, scrambleText, splitText, stagger } from 'animejs';
import { Cpu, Download, Play, ShieldCheck, Timer } from 'lucide-react';
import { WaveformGrid } from '@/components/WaveformGrid';
import { reducedMotion } from '@/lib/motion';

const HEADLINE = 'Sub-15ms Assistive Speech Realignment. Audio Stays On-Device.';
const SUBHEADLINE = 'No Audio Uploads. No AI in the Speech Path. Direct OS Integration.';
// The subheadline first appears the way garbled speech reaches the grammar engine, then snaps into order.
const GARBLED = 'Uploads No Audio. Path the No AI Speech in. OS Direct Integration.';

const BADGES = [
  { icon: Timer, text: 'Sub-15 ms analysis' },
  { icon: ShieldCheck, text: 'Audio never leaves your computer' },
  { icon: Cpu, text: 'DSP, LPC, FFT and a formal grammar' },
];

interface HeroProps {
  onDownload: () => void;
}

/**
 * The one page-load sequence on the site: the signal floor boots, the headline is set down character by
 * character, the subheadline arrives out of order and is rebuilt (the product's own trick), then the
 * badges and buttons take their places.
 */
export function Hero({ onDownload }: HeroProps) {
  const root = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const section = root.current;
    const headline = headlineRef.current;
    const sub = subRef.current;
    if (!section || !headline || !sub) return;
    const rest = section.querySelectorAll<HTMLElement>('.hero-badge, .hero-cta, .hero-meta');

    if (reducedMotion()) {
      headline.style.opacity = '1';
      sub.style.opacity = '1';
      sub.textContent = SUBHEADLINE;
      rest.forEach((element) => (element.style.opacity = '1'));
      return;
    }

    const split = splitText(headline, { chars: { wrap: 'clip' }, words: { wrap: 'clip' } });
    headline.style.opacity = '1';
    sub.style.opacity = '1';
    sub.textContent = GARBLED;

    const sequence = createTimeline({ defaults: { ease: 'outExpo' } })
      .add(split.chars, { y: ['110%', '0%'], rotate: [4, 0], duration: 900, delay: stagger(14, { start: 500 }) }, 0)
      .add(sub, { innerHTML: scrambleText({ text: SUBHEADLINE, chars: 'uppercase', duration: 1100 }), duration: 1100, ease: 'linear' }, 1250)
      .add(section.querySelectorAll('.hero-badge'), { opacity: [0, 1], scale: [0.85, 1], duration: 600, delay: stagger(90), ease: 'outBack(1.6)' }, 1800)
      .add(section.querySelectorAll('.hero-cta'), { opacity: [0, 1], y: [14, 0], duration: 700, delay: stagger(140) }, 2050)
      .add(section.querySelectorAll('.hero-meta'), { opacity: [0, 1], duration: 800 }, 2300);

    return () => {
      sequence.revert();
      split.revert();
    };
  }, []);

  return (
    <section ref={root} id="top" className="relative isolate overflow-hidden pb-28 pt-32 sm:pt-40">
      <WaveformGrid className="absolute inset-0 -z-10 h-full w-full" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-obsidian to-transparent" aria-hidden />
      <div className="mx-auto max-w-6xl px-6">
        <h1 ref={headlineRef} className="max-w-4xl font-display text-[2.6rem] font-bold leading-[1.05] text-bone opacity-0 sm:text-6xl lg:text-7xl">
          {HEADLINE}
        </h1>
        <p ref={subRef} aria-label={SUBHEADLINE} className="mt-7 max-w-2xl font-mono text-base text-ember opacity-0 sm:text-lg">
          {SUBHEADLINE}
        </p>
        <ul className="mt-9 flex flex-wrap gap-2">
          {BADGES.map(({ icon: Icon, text }) => (
            <li key={text} className="hero-badge badge opacity-0">
              <Icon aria-hidden className="size-3.5 text-ember" />
              {text}
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onDownload} className="hero-cta btn-primary opacity-0">
            <Download aria-hidden className="size-4" />
            Download Desktop Client
          </button>
          <a href="#simulator" className="hero-cta btn-secondary opacity-0">
            <Play aria-hidden className="size-4" />
            Try Live Demo
          </a>
        </div>
        <p className="hero-meta mt-8 max-w-xl text-sm text-smoke opacity-0">
          Move your pointer: the signal floor reacts to speed the way the desktop app reacts to your voice.
        </p>
      </div>
    </section>
  );
}
