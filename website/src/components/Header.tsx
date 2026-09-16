'use client';

import { AudioWaveform, UserRound } from 'lucide-react';
import { useSession } from '@/lib/session';

interface HeaderProps {
  onSignIn: () => void;
  onOpenDashboard: () => void;
}

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#simulator', label: 'Simulator' },
  { href: '#pricing', label: 'Pricing' },
];

export function Header({ onSignIn, onOpenDashboard }: HeaderProps) {
  const { account, ready, backendOnline } = useSession();

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-white/[0.06] bg-obsidian/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
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
            <span className={`size-2 rounded-full ${backendOnline ? 'bg-ember shadow-[0_0_8px_#FF6600]' : backendOnline === false ? 'bg-smoke/40' : 'bg-smoke/20'}`} aria-hidden />
            {backendOnline ? 'Backend online' : backendOnline === false ? 'Backend offline' : 'Checking'}
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
