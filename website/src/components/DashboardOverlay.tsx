'use client';

import { useState } from 'react';
import { Check, Copy, Crown, Download, LogOut, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { formatPrice } from '@/lib/plans';
import { useSession } from '@/lib/session';

interface DashboardOverlayProps {
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
  onUpgrade: () => void;
}

const TIER_LABEL = { free: 'Free', pro: 'Pro', lifetime: 'Lifetime' } as const;
const TIER_ICON = { free: Sparkles, pro: Zap, lifetime: Crown } as const;
const PERIOD_LABEL = { monthly: 'monthly', annual: 'yearly', lifetime: 'one payment' } as const;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-2 text-sm last:border-0">
      <dt className="text-smoke">{label}</dt>
      <dd className="text-right text-bone">{value}</dd>
    </div>
  );
}

/** The signed-in account: plan, licence key and the installer link. */
export function DashboardOverlay({ open, onClose, onDownload, onUpgrade }: DashboardOverlayProps) {
  const { account, subscription, signOut } = useSession();
  const [copied, setCopied] = useState(false);
  if (!open || !account) return null;

  const tier = account.user.planTier;
  const Icon = TIER_ICON[tier];
  const license = account.license;

  const copy = async () => {
    if (!license) return;
    try {
      await navigator.clipboard.writeText(license.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Your Voicematics account" size="lg">
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-black/30 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
              <Icon aria-hidden className="size-5 text-ember" />
            </span>
            <div>
              <p className="font-display text-lg font-semibold text-bone">{TIER_LABEL[tier]} plan</p>
              <p className="text-xs text-smoke">{account.user.email}</p>
            </div>
          </div>
          <dl className="mt-4">
            <Row label="Member since" value={new Date(account.user.createdAt).toLocaleDateString()} />
            <Row label="Status" value={account.user.isActive ? 'Active' : 'Disabled'} />
            {subscription ? (
              <>
                <Row label="Billing" value={`${formatPrice(subscription.amountCents)} ${PERIOD_LABEL[subscription.billingPeriod]}`} />
                <Row label="Card" value={`${subscription.cardBrand} •••• ${subscription.cardLast4}`} />
                <Row label={subscription.currentPeriodEnd ? 'Renews' : 'Access'} value={subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : 'Lifetime'} />
              </>
            ) : (
              <Row label="Billing" value="No subscription" />
            )}
          </dl>
          {tier !== 'lifetime' && (
            <button type="button" onClick={onUpgrade} className="btn-secondary mt-4 w-full justify-center">
              <Zap aria-hidden className="size-4" />
              {tier === 'free' ? 'Upgrade to Pro' : 'Get lifetime access'}
            </button>
          )}
        </section>

        <section className="rounded-xl border border-ember/40 bg-black/30 p-5">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-smoke">
            <ShieldCheck aria-hidden className="size-3.5 text-ember" />
            Desktop licence
          </p>
          {license ? (
            <>
              <p className="mt-3 break-all font-mono text-xl font-bold tracking-widest text-bone">{license.key}</p>
              <dl className="mt-3">
                <Row label="Tier" value={TIER_LABEL[license.tier]} />
                <Row label="Machine" value={license.hardwareBound ? `Bound since ${license.activatedAt ? new Date(license.activatedAt).toLocaleDateString() : 'activation'}` : 'Not activated yet'} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy()} className="btn-secondary">
                  {copied ? <Check aria-hidden className="size-4 text-ember" /> : <Copy aria-hidden className="size-4" />}
                  {copied ? 'Copied' : 'Copy key'}
                </button>
                <button type="button" onClick={onDownload} className="btn-primary">
                  <Download aria-hidden className="size-4" />
                  Download installer
                </button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-smoke">No licence key on this account.</p>
          )}
        </section>
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => {
            signOut();
            onClose();
          }}
          className="btn-secondary"
        >
          <LogOut aria-hidden className="size-4" />
          Sign out
        </button>
      </div>
    </Modal>
  );
}
