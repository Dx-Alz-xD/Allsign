'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { riseIn } from '@/lib/motion';

interface RevealProps {
  /** Re-runs the entrance whenever this changes: the view id, the profile, the step of a flow. */
  id: string;
  children: ReactNode;
  className?: string;
  step?: number;
}

/** Rises its direct children into place, one after the other, each time `id` changes. */
export function Reveal({ id, children, className, step = 60 }: RevealProps) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = root.current;
    if (!container) return;
    const run = riseIn(Array.from(container.children), { step });
    return () => {
      run?.revert();
    };
  }, [id, step]);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
