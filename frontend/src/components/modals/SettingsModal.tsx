'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AudioLines, Contrast, Keyboard, Network, type LucideIcon } from 'lucide-react';
import { Modal, buttonStyles } from '@/components/modals/Modal';
import { AudioSettingsPanel } from '@/components/modals/settings/AudioSettingsPanel';
import { DisplaySettingsPanel } from '@/components/modals/settings/DisplaySettingsPanel';
import { NetworkSettingsPanel } from '@/components/modals/settings/NetworkSettingsPanel';
import { ShortcutSettingsPanel } from '@/components/modals/settings/ShortcutSettingsPanel';
import { cn } from '@/lib/cn';

export type SettingsTab = 'display' | 'audio' | 'shortcuts' | 'network';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
  { id: 'display', label: 'Display', icon: Contrast },
  { id: 'audio', label: 'Audio devices', icon: AudioLines },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
  { id: 'network', label: 'Network', icon: Network },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsModal({ open, onClose, initialTab = 'display' }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // Tabs follow the ARIA pattern: arrow keys move between tabs and select them, Home and End jump.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.id === tab);
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next].id;
    setTab(target);
    tabRefs.current[target]?.focus();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      description="Changes save on this device as you make them. Network servers save when you choose Save."
      size="xl"
      footer={
        <button type="button" onClick={onClose} className={buttonStyles.primary}>
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-6 md:flex-row">
        <div
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
          onKeyDown={handleTabKeyDown}
          className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:w-56 md:flex-col md:overflow-visible md:px-0"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const selected = id === tab;
            return (
              <button
                key={id}
                ref={(element) => {
                  tabRefs.current[id] = element;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                className={cn(
                  'relative flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-left font-display font-semibold transition-colors',
                  selected ? 'bg-white/[0.08] text-ink' : 'text-mist hover:bg-white/[0.05] hover:text-ink',
                )}
              >
                {selected && (
                  <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-neon-cyan md:inset-x-auto md:inset-y-2 md:left-0 md:h-auto md:w-1" />
                )}
                <Icon aria-hidden className={cn('size-5 shrink-0', selected ? 'text-neon-cyan' : 'text-dim')} />
                {label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${tab}`}
          tabIndex={0}
          className="min-w-0 flex-1 rounded-lg"
        >
          {tab === 'display' && <DisplaySettingsPanel />}
          {tab === 'audio' && <AudioSettingsPanel />}
          {tab === 'shortcuts' && <ShortcutSettingsPanel />}
          {tab === 'network' && <NetworkSettingsPanel />}
        </div>
      </div>
    </Modal>
  );
}
