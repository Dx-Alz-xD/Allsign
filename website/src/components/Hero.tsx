'use client';

import { useEffect, useRef } from 'react';
import { createScope, animate, stagger } from 'animejs';
import { Cpu, Download, Play, ShieldCheck, Timer } from 'lucide-react';
import { WaveformGrid } from '@/components/WaveformGrid';

const BADGES = [
  { icon: Timer, text: 'Sub-15 ms analysis' },
  { icon: ShieldCheck, text: 'Audio never leaves your computer' },
  { icon: Cpu, text: 'DSP, LPC, FFT and a formal grammar' },
];

interface HeroProps {
  onDownload: () => void;
}

export function Hero({ onDownload }: HeroProps) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const scope = createScope({ root }).add(() => {
      // Staggered entrance: headline words, then the subheadline, badges and buttons.
      animate('.hero-word', {
        opacity: [0, 1],
        y: [28, 0],
        filter: ['blur(8px)', 'blur(0px)'],
        duration: 900,
        delay: stagger(60, { start: 120 }),
        ease: 'outExpo',
      });
      animate('.hero-sub', {
        opacity: [0, 1],
        y: [16, 0],
        duration: 800,
        delay: stagger(120, { start: 520 }),
        ease: 'outCubic',
      });
      animate('.hero-badge', {
        opacity: [0, 1],
        scale: [0.85, 1],
        duration: 600,
        delay: stagger(90, { start: 900 }),
        ease: 'outBack(1.6)',
      });
      animate('.hero-cta', {
        opacity: [0, 1],
        y: [12, 0],
        duration: 700,
        delay: stagger(140, { start: 1150 }),
        ease: 'outCubic',
      });
    });
    return () => scope.revert();
  }, []);

  const headline = 'Sub-15ms Assistive Speech Realignment. Audio Stays On-Device.'.split(' ');

  return (
    <section ref={root} id="top" className="relative isolate overflow-hidden pb-24 pt-28 sm:pt-36">
      <WaveformGrid className="absolute inset-0 -z-10 h-full w-full opacity-90" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(255,102,0,0.14),transparent_60%)]" aria-hidden />
      <div className="mx-auto max-w-6xl px-6">
        <h1 className="max-w-4xl font-display text-4xl font-bold leading-tight text-bone sm:text-6xl">
          {headline.map((word, index) => (
            <span key={`${word}-${index}`} className="hero-word inline-block opacity-0">
              {word.includes('15ms') || word === 'On-Device.' ? <span className="ember-text">{word}</span> : word}
              &nbsp;
            </span>
          ))}
        </h1>
        <p className="hero-sub mt-6 max-w-2xl text-lg text-smoke opacity-0 sm:text-xl">
          No Audio Uploads. No AI in the Speech Path. Direct OS Integration.
        </p>
        <ul className="mt-8 flex flex-wrap gap-2">
          {BADGES.map(({ icon: Icon, text }) => (
            <li key={text} className="hero-badge badge opacity-0">
              <Icon aria-hidden className="size-3.5 text-ember" />
              {text}
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap gap-3">
          <button type="button" onClick={onDownload} className="hero-cta btn-primary opacity-0">
            <Download aria-hidden className="size-4" />
            Download Desktop Client
          </button>
          <a href="#simulator" className="hero-cta btn-secondary opacity-0">
            <Play aria-hidden className="size-4" />
            Try Live Demo
          </a>
        </div>
      </div>
    </section>
  );
}
