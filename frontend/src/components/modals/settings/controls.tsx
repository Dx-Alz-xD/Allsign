'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function SettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div>
        <h3 id={headingId} className="text-lg font-semibold text-ink">
          {title}
        </h3>
        {description && <p className="mt-1 max-w-prose text-mist">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  describedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-3 rounded-xl py-1 pr-2"
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors',
          checked ? 'border-neon-cyan bg-neon-cyan' : 'border-dim bg-transparent',
        )}
      >
        <span
          className={cn(
            'size-5 rounded-full transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-[1.35rem] bg-void' : 'translate-x-0.5 bg-mist',
          )}
        />
      </span>
      <span className="font-display text-lg font-semibold text-ink">{label}</span>
      <span aria-hidden className={cn('text-sm font-bold', checked ? 'text-neon-cyan' : 'text-mist')}>
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  );
}

export const inputStyles =
  'w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-ink placeholder:text-dim aria-[invalid=true]:border-warn disabled:opacity-60';

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-sm text-warn">
      {children}
    </p>
  );
}
