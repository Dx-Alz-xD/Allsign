'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ProfileMode } from '@shared/types';
import { ProBadge } from '@/components/account/PlanGate';
import { useModals } from '@/components/modals/ModalProvider';
import { useAccount } from '@/components/providers/AccountProvider';
import { MODE_ITEMS, NAV_ITEMS, type ModeItem, type ViewId } from '@/lib/navigation';
import { cn } from '@/lib/cn';

interface SidebarProps {
  active: ViewId;
  activeProfile: ProfileMode;
  onSelect: (view: ViewId) => void;
  onSelectMode: (item: ModeItem) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

interface Entry {
  key: string;
  label: string;
  icon: ModeItem['icon'];
  active: boolean;
  locked: boolean;
  select: () => void;
}

function EntryList({ entries, indicatorId, heading }: { entries: Entry[]; indicatorId: string; heading: string }) {
  return (
    <div>
      <p className="mb-1 px-3 text-xs font-bold text-dim">{heading}</p>
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.key}>
              <button
                type="button"
                onClick={entry.select}
                aria-current={entry.active ? 'page' : undefined}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-display text-[0.95rem] font-semibold transition-colors',
                  entry.active ? 'bg-white/[0.08] text-ink' : 'text-mist hover:bg-white/[0.05] hover:text-ink',
                )}
              >
                {entry.active && (
                  <motion.span
                    layoutId={indicatorId}
                    aria-hidden
                    className="absolute inset-y-2 left-0 w-1 rounded-full bg-neon-edge shadow-neon"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon aria-hidden className={cn('size-5 shrink-0', entry.active ? 'text-neon-cyan' : 'text-dim')} />
                <span className="min-w-0 flex-1">{entry.label}</span>
                {entry.locked && <ProBadge />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Modes on top (each sets the profile and opens its view), then everything else. */
function NavList({
  active,
  activeProfile,
  onSelect,
  onSelectMode,
  indicatorId,
}: {
  active: ViewId;
  activeProfile: ProfileMode;
  onSelect: (view: ViewId) => void;
  onSelectMode: (item: ModeItem) => void;
  indicatorId: string;
}) {
  const { has } = useAccount();
  const modes: Entry[] = MODE_ITEMS.map((item) => ({
    key: `mode-${item.profile}`,
    label: item.label,
    icon: item.icon,
    active: item.view === 'triggers' ? active === 'triggers' : active === 'home' && activeProfile === item.profile,
    locked: item.feature !== null && !has(item.feature),
    select: () => onSelectMode(item),
  }));
  const rest: Entry[] = NAV_ITEMS.map((item) => ({
    key: item.id,
    label: item.label,
    icon: item.icon,
    active: item.id === active,
    locked: item.feature !== undefined && !has(item.feature),
    select: () => onSelect(item.id),
  }));
  return (
    <div className="flex flex-col gap-5">
      <EntryList entries={modes} indicatorId={`${indicatorId}-modes`} heading="Modes" />
      <EntryList entries={rest} indicatorId={`${indicatorId}-more`} heading="More" />
    </div>
  );
}

function SidebarFooter() {
  const { openModal } = useModals();
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const linkStyle = 'rounded text-sm font-semibold text-mist underline decoration-white/30 underline-offset-4 hover:text-ink';
  return (
    <div className="mt-auto space-y-2 px-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" onClick={() => openModal({ kind: 'privacy' })} className={linkStyle}>
          Privacy
        </button>
        <button type="button" onClick={() => openModal({ kind: 'terms' })} className={linkStyle}>
          Terms
        </button>
      </div>
      {appVersion && <p className="text-sm text-dim">Version {appVersion}</p>}
    </div>
  );
}

export function Sidebar({ active, activeProfile, onSelect, onSelectMode, mobileOpen, onMobileClose }: SidebarProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileClose();
    };
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const handleViewportChange = () => {
      if (desktop.matches) onMobileClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    desktop.addEventListener('change', handleViewportChange);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      desktop.removeEventListener('change', handleViewportChange);
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 flex-col border-r border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl lg:flex">
        <nav aria-label="Primary" className="overflow-y-auto">
          <NavList active={active} activeProfile={activeProfile} onSelect={onSelect} onSelectMode={onSelectMode} indicatorId="nav-indicator-desktop" />
        </nav>
        <SidebarFooter />
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <div key="mobile-nav" className="lg:hidden">
            <motion.div
              aria-hidden
              onClick={onMobileClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-x-0 bottom-0 top-16 z-30 bg-void/70 backdrop-blur-sm"
            />
            <motion.div
              ref={drawerRef}
              id="mobile-nav"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 42 }}
              className="fixed bottom-0 left-0 top-16 z-40 flex w-72 max-w-[85vw] flex-col border-r border-white/10 bg-[#0E1420]/95 p-4 backdrop-blur-2xl"
            >
              <nav aria-label="Primary" className="overflow-y-auto">
                <NavList active={active} activeProfile={activeProfile} onSelect={onSelect} onSelectMode={onSelectMode} indicatorId="nav-indicator-mobile" />
              </nav>
              <SidebarFooter />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
