'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { animate, onScroll } from 'animejs';
import { Menu, X } from 'lucide-react';
import { Avatar, BrandMark } from '@/components/site/BrandMark';
import { useAuthFlow } from '@/components/site/SiteProviders';
import { reducedMotion } from '@/lib/motion';
import { useSession } from '@/lib/session';

const NAV = [
  { href: '/#features', label: 'Features' },
  { href: '/#simulator', label: 'Demo' },
  { href: '/caregiver', label: 'Caregivers' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/help', label: 'Help' },
];

export function SiteHeader() {
  const { account, ready, backendOnline, waking } = useSession();
  const { openSignIn } = useAuthFlow();
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  // On the home page the bar tightens and its bottom edge lights once the hero scrolls away.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || reducedMotion() || pathname !== '/' || !document.getElementById('top')) return;
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
  }, [pathname]);

  const name = account?.profile?.displayName || account?.profile?.username || account?.user.email || '';

  return (
    <header className="fixed inset-x-0 top-0 z-30 bg-obsidian/80 backdrop-blur">
      <div ref={barRef} className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 border-b border-white/[0.06] px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold text-bone">
          <BrandMark />
          Voicematics
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm text-smoke lg:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} className={`hover:text-bone ${pathname === item.href ? 'text-bone' : ''}`}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden items-center gap-1.5 text-xs text-smoke xl:flex">
            <span className={`size-2 rounded-full ${backendOnline ? 'bg-ember shadow-[0_0_8px_#FF6600]' : backendOnline === false ? 'bg-smoke/40' : waking ? 'animate-pulse bg-ember/70' : 'bg-smoke/20'}`} aria-hidden />
            {backendOnline ? 'Server online' : backendOnline === false ? 'Server offline' : waking ? 'Waking up the server' : 'Checking the server'}
          </span>
          {ready && account ? (
            <Link href="/account" className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 text-sm text-bone transition hover:border-ember/60" aria-label="Your profile">
              <Avatar name={name} size="sm" />
              <span className="hidden max-w-[9rem] truncate sm:block">{account.profile ? `@${account.profile.username}` : account.user.email}</span>
            </Link>
          ) : (
            <button type="button" onClick={openSignIn} className="btn-secondary px-4 py-2">
              Sign in
            </button>
          )}
          <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="site-menu" aria-label={menuOpen ? 'Close menu' : 'Open menu'} className="rounded-lg p-2 text-smoke hover:bg-white/10 hover:text-bone lg:hidden">
            {menuOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="site-menu" aria-label="Main" className="border-b border-white/[0.06] bg-obsidian/95 px-4 py-3 lg:hidden">
          <ul className="grid gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2.5 text-bone hover:bg-white/[0.06]">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
