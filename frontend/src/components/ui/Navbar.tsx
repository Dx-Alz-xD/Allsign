'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { animate } from 'animejs';
import { AudioWaveform, CircleUserRound, Menu, Mic, MicOff, Settings, WifiOff, X } from 'lucide-react';
import type { ProfileMode } from '@shared/types';
import { useAccount } from '@/components/providers/AccountProvider';
import { useSession } from '@/components/providers/SessionProvider';
import { reducedMotion } from '@/lib/motion';
import { ProfileSwitcher } from '@/components/ui/ProfileSwitcher';
import { PLAN_NAMES } from '@/lib/account/plans';
import { cn } from '@/lib/cn';

interface NavbarProps {
  profile: ProfileMode;
  onProfileChange: (profile: ProfileMode) => void;
  navOpen: boolean;
  onToggleNav: () => void;
  menuButtonRef: RefObject<HTMLButtonElement>;
  muted: boolean;
  onToggleMute: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}

export function Navbar({
  profile,
  onProfileChange,
  navOpen,
  onToggleNav,
  menuButtonRef,
  muted,
  onToggleMute,
  onOpenSettings,
  onOpenAccount,
}: NavbarProps) {
  const { entitlements, offline, email } = useAccount();
  const { live } = useSession();
  const plan = PLAN_NAMES[entitlements.tier];
  const markRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const mark = markRef.current;
    if (!mark || !live || reducedMotion()) return;
    const breathe = animate(mark, {
      boxShadow: ['0 0 0 0 rgba(0, 242, 254, 0.55)', '0 0 0 9px rgba(0, 242, 254, 0)'],
      duration: 1600,
      ease: 'outSine',
      loop: true,
    });
    return () => {
      breathe.revert();
    };
  }, [live]);

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-white/10 bg-void/70 backdrop-blur-xl">
      <div className="flex h-full items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="Menu"
          aria-expanded={navOpen}
          aria-controls="mobile-nav"
          onClick={onToggleNav}
          className="inline-flex size-10 items-center justify-center rounded-lg text-ink hover:bg-white/10 lg:hidden"
        >
          {navOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span ref={markRef} className="grid size-9 shrink-0 place-items-center rounded-lg bg-neon-edge shadow-neon-soft" title={live ? 'Microphone live' : undefined}>
            <AudioWaveform aria-hidden className="size-5 text-void" strokeWidth={2.5} />
          </span>
          <span className="hidden font-display text-lg font-bold tracking-tight text-ink sm:inline">
            Voicematics
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenAccount}
            aria-label={`Account: ${email ?? ''}, ${plan} plan${offline ? ', offline' : ''}`}
            title={email ?? undefined}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.06] px-2.5 text-mist transition-colors hover:border-neon-cyan/40 hover:text-ink"
          >
            {offline ? <WifiOff aria-hidden className="size-[18px] text-warn" /> : <CircleUserRound aria-hidden className="size-[18px]" />}
            <span aria-hidden className={`hidden font-display text-sm font-semibold md:inline ${entitlements.tier === 'free' ? '' : 'text-neon-cyan'}`}>
              {plan}
            </span>
          </button>
          <button
            type="button"
            aria-label="Settings"
            onClick={onOpenSettings}
            className="hidden size-10 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.06] text-mist transition-colors hover:border-neon-cyan/40 hover:text-ink sm:inline-flex"
          >
            <Settings aria-hidden className="size-[18px]" />
          </button>
          <button
            type="button"
            aria-label="Mute microphone"
            aria-pressed={muted}
            onClick={onToggleMute}
            className={cn(
              'inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-xl border px-2.5 transition-colors',
              muted
                ? 'border-warn/60 bg-warn/10 text-warn'
                : 'border-white/[0.12] bg-white/[0.06] text-mist hover:border-neon-cyan/40 hover:text-ink',
            )}
          >
            {muted ? <MicOff aria-hidden className="size-[18px]" /> : <Mic aria-hidden className="size-[18px]" />}
            {muted && (
              <span aria-hidden className="hidden font-display text-sm font-semibold sm:inline">
                Muted
              </span>
            )}
          </button>
          <ProfileSwitcher value={profile} onChange={onProfileChange} />
        </div>
      </div>
    </header>
  );
}
