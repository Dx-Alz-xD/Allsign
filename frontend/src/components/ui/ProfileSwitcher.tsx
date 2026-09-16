'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import type { ProfileMode } from '@shared/types';
import { PROFILE_PRESETS, getProfilePreset } from '@/lib/profiles';
import { cn } from '@/lib/cn';

interface ProfileSwitcherProps {
  value: ProfileMode;
  onChange: (profile: ProfileMode) => void;
}

const LAST_INDEX = PROFILE_PRESETS.length - 1;

function indexOfProfile(profile: ProfileMode): number {
  return Math.max(0, PROFILE_PRESETS.findIndex((preset) => preset.id === profile));
}

export function ProfileSwitcher({ value, onChange }: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => indexOfProfile(value));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const baseId = useId();
  const labelId = `${baseId}-label`;
  const buttonId = `${baseId}-button`;
  const listId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const selected = getProfilePreset(value);
  const SelectedIcon = selected.icon;

  const openList = () => {
    setActiveIndex(indexOfProfile(value));
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    onChange(PROFILE_PRESETS[index].id);
    closeList();
  };

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, baseId]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, LAST_INDEX));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(LAST_INDEX);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeList();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <span id={labelId} className="sr-only">
        Profile preset
      </span>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${buttonId}`}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleButtonKeyDown}
        className={cn(
          'flex h-10 max-w-[13rem] items-center gap-2 rounded-xl border px-3 transition-colors sm:max-w-none',
          open
            ? 'border-neon-cyan/60 bg-white/10 shadow-neon-soft'
            : 'border-white/[0.12] bg-white/[0.06] hover:border-neon-cyan/40 hover:bg-white/10',
        )}
      >
        <SelectedIcon aria-hidden className="size-[18px] shrink-0 text-neon-cyan" />
        <span className="truncate font-display text-sm font-semibold text-ink">{selected.label}</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 text-mist transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={optionId(activeIndex)}
            onKeyDown={handleListKeyDown}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100dvh-5rem)] w-[min(23rem,calc(100vw-2rem))] origin-top-right overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#111723] p-1.5 shadow-2xl shadow-black/60 focus:outline-none"
          >
            {PROFILE_PRESETS.map((preset, index) => {
              const Icon = preset.icon;
              const isSelected = preset.id === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={preset.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5',
                    isActive && 'bg-white/[0.08] ring-1 ring-inset ring-neon-cyan/60',
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cn('mt-0.5 size-5 shrink-0', isSelected ? 'text-neon-cyan' : 'text-mist')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[0.95rem] font-semibold text-ink">
                      {preset.label}
                    </span>
                    <span className="mt-0.5 block text-sm leading-snug text-mist">{preset.description}</span>
                  </span>
                  {isSelected && <Check aria-hidden className="mt-1 size-4 shrink-0 text-neon-cyan" />}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
