'use client';

import { useState, type ReactNode } from 'react';
import { ExternalLink, Laptop, Lock, RefreshCw } from 'lucide-react';
import type { Feature } from '@shared/types';
import { buttonStyles } from '@/components/modals/Modal';
import { useAccount } from '@/components/providers/AccountProvider';
import { ApiError } from '@/lib/api/client';
import { FEATURE_NAMES, PLAN_NAMES, openWebsite } from '@/lib/account/plans';
import { cn } from '@/lib/cn';

/** Marks something the current plan does not include. */
export function ProBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-neon-blue/50 px-1.5 py-0.5 font-display text-xs font-semibold text-neon-blue',
        className,
      )}
    >
      <Lock aria-hidden className="size-3" />
      Pro
    </span>
  );
}

/** The two ways out of a locked feature: see plans on the website, or re-read the plan after upgrading there. */
export function UpgradeActions({ compact = false }: { compact?: boolean }) {
  const { refresh, licenceElsewhere, moveLicenceHere, offline } = useAccount();
  const [busy, setBusy] = useState<'refresh' | 'move' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (kind: 'refresh' | 'move') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'move') await moveLicenceHere();
      else await refresh();
    } catch (error) {
      setMessage(error instanceof ApiError || error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const size = compact ? 'h-9 px-3 text-sm' : '';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {licenceElsewhere ? (
          <button type="button" onClick={() => void run('move')} disabled={busy !== null || offline} className={cn(buttonStyles.primary, size)}>
            <Laptop aria-hidden className="size-4" />
            {busy === 'move' ? 'Moving licence' : 'Use my licence on this computer'}
          </button>
        ) : (
          <button type="button" onClick={() => openWebsite('#pricing')} className={cn(buttonStyles.primary, size)}>
            <ExternalLink aria-hidden className="size-4" />
            See plans
          </button>
        )}
        <button type="button" onClick={() => void run('refresh')} disabled={busy !== null || offline} className={cn(buttonStyles.secondary, size)}>
          <RefreshCw aria-hidden className={cn('size-4', busy === 'refresh' && 'animate-spin motion-reduce:animate-none')} />
          {busy === 'refresh' ? 'Checking' : 'I upgraded, check again'}
        </button>
      </div>
      {offline && <p className="text-sm text-mist">Plan changes can be checked once Voicematics reaches its server again.</p>}
      {message && (
        <p role="alert" className="text-sm text-warn">
          {message}
        </p>
      )}
    </div>
  );
}

interface LockedFeatureProps {
  feature: Feature;
  /** What the feature does, in a sentence or two. */
  children: ReactNode;
  className?: string;
}

/** Stands in for a feature the plan does not include, so every feature stays visible and explains itself. */
export function LockedFeature({ feature, children, className }: LockedFeatureProps) {
  const { entitlements, licenceElsewhere } = useAccount();
  return (
    <section aria-labelledby={`locked-${feature}`} className={cn('glass rounded-2xl p-5 sm:p-6', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`locked-${feature}`} className="text-xl font-semibold text-ink">
          {FEATURE_NAMES[feature]}
        </h2>
        <ProBadge />
      </div>
      <div className="mt-2 max-w-prose leading-relaxed text-mist">{children}</div>
      <p className="mt-3 text-sm text-mist">
        {licenceElsewhere
          ? 'Your Pro licence is active on another computer, so this one runs on the Free plan. Move the licence here to use it.'
          : `You are on the ${PLAN_NAMES[entitlements.tier]} plan. ${FEATURE_NAMES[feature]} comes with Voicematics Pro and Lifetime.`}
      </p>
      <div className="mt-4">
        <UpgradeActions />
      </div>
    </section>
  );
}
