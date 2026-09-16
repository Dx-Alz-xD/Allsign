'use client';

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  bodyRef?: RefObject<HTMLDivElement>;
  children: ReactNode;
}

const SIZES = { md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

/**
 * Accessible modal built on the native <dialog>: showModal() makes the rest of the page inert, moves
 * focus inside, and handles Escape. Content only mounts while open.
 */
export function Modal({ open, onClose, title, description, size = 'lg', footer, bodyRef, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    openRef.current = open;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(
    () => () => {
      document.documentElement.style.overflow = '';
    },
    [],
  );

  const handleClose = () => {
    document.documentElement.style.overflow = '';
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
    // The browser can close a dialog on its own (e.g. repeated Escape); keep React state in sync.
    if (openRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={handleClose}
      className={cn(
        'm-auto max-h-[min(92dvh,64rem)] w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-white/15 bg-panel p-0 text-ink shadow-2xl shadow-black/70 backdrop:bg-void/80 backdrop:backdrop-blur-sm open:flex open:flex-col',
        SIZES[size],
      )}
    >
      {open && (
        <>
          <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id={titleId} className="text-2xl font-bold text-ink">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 max-w-prose text-mist">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:bg-white/10 hover:text-ink"
            >
              <X aria-hidden className="size-5" />
            </button>
          </header>
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {children}
          </div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4 sm:px-6">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  );
}

export const buttonStyles = {
  primary:
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-neon-cyan px-4 font-display font-semibold text-void transition-colors hover:bg-neon-cyan/85 disabled:cursor-not-allowed disabled:opacity-60',
  secondary:
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 font-display font-semibold text-ink transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60',
  danger:
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-warn px-4 font-display font-semibold text-void transition-colors hover:bg-warn/85 disabled:cursor-not-allowed disabled:opacity-60',
  link: 'font-semibold text-neon-cyan underline decoration-neon-cyan/50 underline-offset-4 hover:decoration-neon-cyan',
} as const;
