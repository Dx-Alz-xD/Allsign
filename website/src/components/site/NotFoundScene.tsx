'use client';

/**
 * The 404: the number arrives the way stuttered speech does ("4… 4-4… 0-0… 4"), then is cleaned up into "404",
 * the product's own trick, over a signal trace that has gone flat except for the odd blip of something lost.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { animate, createTimeline, stagger } from 'animejs';
import { ArrowRight, CircleHelp, Compass, Home, Info, Radio, Search, UserRound } from 'lucide-react';
import { reducedMotion } from '@/lib/motion';

const STUTTER = ['4', '4', '-', '4', '0', '-', '0', '4'];
const CLEAN = ['4', '0', '4'];

const LINKS = [
  { href: '/', label: 'Home', detail: 'Start from the top', icon: Home },
  { href: '/about', label: 'How it works', detail: 'The whole story, in one page', icon: Info },
  { href: '/caregiver', label: 'Caregiver console', detail: 'Watch someone who approved you', icon: Radio },
  { href: '/account', label: 'Your profile', detail: 'Plan, licence and caregivers', icon: UserRound },
];

export function NotFoundScene() {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<SVGPathElement>(null);
  const blipRef = useRef<SVGCircleElement>(null);
  const [cleaned, setCleaned] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (reducedMotion()) {
      setCleaned(true);
      stage.querySelectorAll<HTMLElement>('[data-fade]').forEach((element) => (element.style.opacity = '1'));
      return;
    }
    const stutter = stage.querySelectorAll('[data-stutter]');
    const intro = createTimeline({ defaults: { ease: 'outExpo' } })
      .add(stutter, { opacity: [0, 1], y: [40, 0], scale: [0.6, 1], duration: 380, delay: stagger(95) }, 150)
      .add(stutter, { x: () => (Math.random() - 0.5) * 18, duration: 90, loop: 4, alternate: true, ease: 'linear' }, 1000)
      .add(stutter, { opacity: 0, scale: 0.4, filter: ['blur(0px)', 'blur(10px)'], duration: 380, delay: stagger(30, { from: 'center' }) }, 1450)
      .call(() => setCleaned(true), 1800);
    return () => {
      intro.revert();
    };
  }, []);

  // Once cleaned, the digits land and the rest of the page follows.
  useEffect(() => {
    const stage = stageRef.current;
    if (!cleaned || !stage || reducedMotion()) return;
    const run = createTimeline({ defaults: { ease: 'outBack(1.7)' } })
      .add(stage.querySelectorAll('[data-digit]'), { opacity: [0, 1], y: [-30, 0], scale: [1.4, 1], duration: 700, delay: stagger(110) }, 0)
      .add(stage.querySelectorAll('[data-fade]'), { opacity: [0, 1], y: [18, 0], duration: 700, delay: stagger(90), ease: 'outCubic' }, 350);
    return () => {
      run.revert();
    };
  }, [cleaned]);

  // A flat trace with a blip that crosses it, as if a word nearly came through.
  useEffect(() => {
    const trace = traceRef.current;
    const blip = blipRef.current;
    if (!trace || !blip || reducedMotion()) return;
    const state = { t: 0 };
    const width = 1200;
    const draw = () => {
      const centre = state.t * width;
      const points: string[] = [];
      for (let x = 0; x <= width; x += 8) {
        const distance = (x - centre) / 26;
        const spike = Math.exp(-distance * distance) * 70 * Math.sin(distance * 2.4);
        points.push(`${x},${60 - spike}`);
      }
      trace.setAttribute('d', `M${points.join(' L')}`);
      blip.setAttribute('cx', String(centre));
    };
    const run = animate(state, { t: [-0.1, 1.1], duration: 3200, loop: true, ease: 'inOutSine', loopDelay: 900, onUpdate: draw });
    return () => {
      run.revert();
    };
  }, []);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    window.dispatchEvent(new CustomEvent('voicematics:open-help', { detail: { query: text } }));
    if (!text) router.push('/help');
  };

  return (
    <main className="relative isolate overflow-hidden pb-16 pt-28 sm:pt-36">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-40 -z-10 size-[42rem] -translate-x-1/2 rounded-full bg-crimson/10 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />

      <div ref={stageRef} className="mx-auto max-w-5xl px-6 text-center">
        <p data-fade className="badge opacity-0">
          <Compass aria-hidden className="size-3.5 text-ember" />
          Error 404 · page not found
        </p>

        <h1 className="relative mt-8 select-none font-display font-bold leading-none text-bone" aria-label="404">
          <span aria-hidden className="relative block h-[9rem] sm:h-[13rem] lg:h-[16rem]">
            {!cleaned && (
              <span className="absolute inset-0 flex items-center justify-center gap-1 text-6xl text-smoke sm:gap-2 sm:text-8xl">
                {STUTTER.map((char, index) => (
                  <span key={index} data-stutter className={`inline-block opacity-0 ${char === '-' ? 'text-ember/70' : ''}`}>
                    {char}
                  </span>
                ))}
              </span>
            )}
            {cleaned && (
              <span className="absolute inset-0 flex items-center justify-center text-[8rem] tracking-tight sm:text-[12rem] lg:text-[15rem]">
                {CLEAN.map((char, index) => (
                  <span key={index} data-digit className="ember-text inline-block opacity-0 drop-shadow-[0_0_40px_rgba(255,80,0,0.45)] motion-reduce:opacity-100">
                    {char}
                  </span>
                ))}
              </span>
            )}
          </span>
        </h1>

        <svg data-fade viewBox="0 0 1200 120" preserveAspectRatio="none" className="mx-auto mt-2 h-20 w-full max-w-4xl opacity-0" aria-hidden>
          <defs>
            <linearGradient id="trace-fade" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#FF3333" stopOpacity="0" />
              <stop offset="0.5" stopColor="#FF6600" stopOpacity="1" />
              <stop offset="1" stopColor="#FF3333" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path ref={traceRef} d="M0,60 L1200,60" fill="none" stroke="url(#trace-fade)" strokeWidth="3" strokeLinecap="round" />
          <circle ref={blipRef} cx="-50" cy="60" r="5" fill="#FF6600" />
        </svg>

        <h2 data-fade className="mt-6 font-display text-3xl font-bold text-bone opacity-0 sm:text-5xl">
          This page went silent.
        </h2>
        <p data-fade className="mx-auto mt-4 max-w-xl text-lg text-smoke opacity-0">
          We cleaned up the stutter, but there is nothing at this address. The link may be old, or a word got mistyped along the way.
        </p>

        <form data-fade onSubmit={search} className="mx-auto mt-8 flex max-w-lg gap-2 opacity-0">
          <label htmlFor="lost-search" className="sr-only">
            Search the help answers
          </label>
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-smoke" />
            <input id="lost-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What were you looking for?" className="field h-12 pl-10" />
          </div>
          <button type="submit" className="btn-primary h-12 px-4">
            <CircleHelp aria-hidden className="size-4" />
            Ask
          </button>
        </form>

        <ul className="mx-auto mt-12 grid max-w-4xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
          {LINKS.map(({ href, label, detail, icon: Icon }) => (
            <li key={href} data-fade className="opacity-0">
              <Link href={href} className="group flex h-full flex-col rounded-2xl border border-white/10 bg-onyx/80 p-4 transition hover:-translate-y-0.5 hover:border-ember/60 hover:shadow-ember-soft">
                <span className="grid size-9 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
                  <Icon aria-hidden className="size-4 text-ember" />
                </span>
                <span className="mt-3 flex items-center gap-1 font-display font-semibold text-bone">
                  {label}
                  <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
                <span className="mt-1 text-sm text-smoke">{detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
