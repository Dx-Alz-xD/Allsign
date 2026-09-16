'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useModals } from '@/components/modals/ModalProvider';
import { NAV_ITEMS, type ViewId } from '@/lib/navigation';
import { cn } from '@/lib/cn';

interface SidebarProps {
  active: ViewId;
  onSelect: (view: ViewId) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const DESKTOP_QUERY = '(min-width: 1024px)';

function NavList({
  active,
  onSelect,
  indicatorId,
}: {
  active: ViewId;
  onSelect: (view: ViewId) => void;
  indicatorId: string;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === active;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-display text-[0.95rem] font-semibold transition-colors',
                isActive ? 'bg-white/[0.08] text-ink' : 'text-mist hover:bg-white/[0.05] hover:text-ink',
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={indicatorId}
                  aria-hidden
                  className="absolute inset-y-2 left-0 w-1 rounded-full bg-neon-edge shadow-neon"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <Icon aria-hidden className={cn('size-5 shrink-0', isActive ? 'text-neon-cyan' : 'text-dim')} />
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
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

export function Sidebar({ active, onSelect, mobileOpen, onMobileClose }: SidebarProps) {
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
        <nav aria-label="Primary">
          <NavList active={active} onSelect={onSelect} indicatorId="nav-indicator-desktop" />
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
              <nav aria-label="Primary">
                <NavList active={active} onSelect={onSelect} indicatorId="nav-indicator-mobile" />
              </nav>
              <SidebarFooter />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
