import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}

export function EmptyState({ icon: Icon, title, children }: EmptyStateProps) {
  return (
    <div className="glass flex flex-col items-center rounded-2xl px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-white/[0.06] ring-1 ring-white/10">
        <Icon aria-hidden className="size-6 text-neon-blue" />
      </span>
      <h2 className="mt-4 text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-2 max-w-md leading-relaxed text-mist">{children}</p>
    </div>
  );
}
