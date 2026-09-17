'use client';

import { useEffect, useRef } from 'react';
import { animate, onScroll } from 'animejs';
import { AudioWaveform, UserRound } from 'lucide-react';
import { reducedMotion } from '@/lib/motion';
import { useSession } from '@/lib/session';

interface HeaderProps {
  onSignIn: () => void;
  onOpenDashboard: () => void;
}

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#simulator', label: 'Simulator' },
  { href: '#caregivers', label: 'Caregivers' },
  { href: '#pricing', label: 'Pricing' },
];

export function Header({ onSignIn, onOpenDashboard }: HeaderProps) {
  const { account, ready, backendOnline, waking } = useSession();
  const barRef = useRef<HTMLDivElement>(null);

  // Past the hero the bar tightens and its bottom edge lights, tied to the scroll position.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || reducedMotion()) return;
    const run = animate(bar, {
      height: ['4rem', '3.25rem'],
      borderBottomColor: ['rgba(255,255,255,0.06)', 'rgba(255,102,0,0.35)'],
      duration: 1,
      ease: 'linear',
      autoplay: onScroll({ target: '#top', enter: 'top top', leave: 'top 280', sync: true }),
    });
    return () => {
      run.revert();
    };
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-30 bg-obsidian/80 backdrop-blur">
      <div ref={barRef} className="mx-auto flex h-16 max-w-6xl items-center justify-between border-b border-white/[0.06] px-6">
        <a href="#top" className="flex items-center gap-2 font-display text-lg font-bold text-bone">
          <AudioWaveform aria-hidden className="size-6 text-ember" />
          Voicematics
        </a>
        <nav aria-label="Sections" className="hidden gap-6 text-sm text-smoke md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-bone">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs text-smoke sm:flex" title="Local backend on port 8000">
            <span className={`size-2 rounded-full ${backendOnline ? 'bg-ember shadow-[0_0_8px_#FF6600]' : backendOnline === false ? 'bg-smoke/40' : waking ? 'animate-pulse bg-ember/70' : 'bg-smoke/20'}`} aria-hidden />
            {backendOnline ? 'Server online' : backendOnline === false ? 'Server offline' : waking ? 'Waking up the server' : 'Checking the server'}
          </span>
          {ready && account ? (
            <button type="button" onClick={onOpenDashboard} className="btn-secondary px-4 py-2 normal-case tracking-normal">
              <UserRound aria-hidden className="size-4 text-ember" />
              <span className="max-w-[10rem] truncate">{account.user.email}</span>
            </button>
          ) : (
            <button type="button" onClick={onSignIn} className="btn-secondary px-4 py-2">
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
