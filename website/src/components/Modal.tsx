'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Wider panels for the dashboard and checkout. */
  size?: 'md' | 'lg';
  /** Set while a request is in flight so the panel cannot be dismissed mid-way. */
  locked?: boolean;
}

/** A centred dialog over a dimmed page. Escape and the backdrop close it unless it is locked. */
export function Modal({ open, onClose, title, children, size = 'md', locked = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open, locked, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !locked && onClose()}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`panel relative max-h-[92vh] w-full overflow-y-auto p-6 shadow-ember outline-none ${size === 'lg' ? 'max-w-3xl' : 'max-w-md'}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-xl font-semibold text-bone">{title}</h2>
          <button type="button" onClick={onClose} disabled={locked} aria-label="Close" className="rounded-lg p-1 text-smoke hover:bg-white/10 hover:text-bone disabled:opacity-40">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
