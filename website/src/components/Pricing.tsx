'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Crown, Sparkles, Zap } from 'lucide-react';
import type { PricingPlan } from '@shared/types';
import { api } from '@/lib/api';
import { FALLBACK_PLANS, formatPrice, periodLabel } from '@/lib/plans';
import { useSession } from '@/lib/session';

interface PricingProps {
  onSubscribe: (plan: PricingPlan) => void;
  onCreateAccount: () => void;
  onOpenDashboard: () => void;
}

const ICONS = { free: Sparkles, pro: Zap, lifetime: Crown } as const;

export function Pricing({ onSubscribe, onCreateAccount, onOpenDashboard }: PricingProps) {
  const { account } = useSession();
  const [plans, setPlans] = useState<PricingPlan[]>(FALLBACK_PLANS);
  const [annual, setAnnual] = useState(false);

  useEffect(() => {
    api.billing
      .plans()
      .then(setPlans)
      .catch(() => undefined);
  }, []);

  const cards = useMemo(() => {
    const byId = new Map(plans.map((plan) => [plan.id, plan]));
    const pro = annual ? byId.get('pro_annual') : byId.get('pro_monthly');
    return [byId.get('free'), pro, byId.get('lifetime')].filter((plan): plan is PricingPlan => Boolean(plan));
  }, [plans, annual]);

  const tier = account?.user.planTier;

  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-ember">Pricing</p>
          <h2 className="mt-3 font-display text-3xl font-bold text-bone sm:text-4xl">One licence, your machine, no cloud bill</h2>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className={annual ? 'text-smoke' : 'text-bone'}>Monthly</span>
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label="Bill annually"
            onClick={() => setAnnual((value) => !value)}
            className={`relative h-7 w-12 rounded-full border transition ${annual ? 'border-ember bg-ember/40' : 'border-white/20 bg-white/10'}`}
          >
            <span className={`absolute top-0.5 size-6 rounded-full bg-bone transition-transform ${annual ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span className={annual ? 'text-bone' : 'text-smoke'}>
            Annual <span className="text-ember">save 28%</span>
          </span>
        </div>
      </div>

      <ul className="mt-10 grid gap-5 lg:grid-cols-3">
        {cards.map((plan) => {
          const Icon = ICONS[plan.tier];
          const featured = plan.tier === 'pro';
          const current = tier === plan.tier;
          return (
            <li key={plan.id} className={`relative flex flex-col rounded-2xl border p-6 ${featured ? 'border-ember/70 bg-onyx shadow-ember' : 'border-white/10 bg-onyx/70'}`}>
              {featured && <span className="absolute -top-3 left-6 rounded-full bg-ember-edge px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-obsidian">Most chosen</span>}
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
                  <Icon aria-hidden className="size-5 text-ember" />
                </span>
                <h3 className="font-display text-lg font-semibold text-bone">{plan.name}</h3>
              </div>
              <p className="mt-5 font-display text-4xl font-bold text-bone">
                {formatPrice(plan.priceCents)}
                <span className="text-base font-normal text-smoke">{periodLabel(plan)}</span>
              </p>
              {plan.id === 'pro_annual' && <p className="mt-1 text-xs text-smoke">{formatPrice(Math.round(plan.priceCents / 12))} a month, billed yearly</p>}
              <ul className="mt-6 flex-1 space-y-2 text-sm text-smoke">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-ember" />
                    {feature}
                  </li>
                ))}
              </ul>
              {plan.tier === 'free' ? (
                <button type="button" onClick={account ? onOpenDashboard : onCreateAccount} className="btn-secondary mt-6 justify-center">
                  {account ? 'Open dashboard' : 'Create free account'}
                </button>
              ) : current ? (
                <button type="button" onClick={onOpenDashboard} className="btn-secondary mt-6 justify-center">
                  Your current plan
                </button>
              ) : (
                <button type="button" onClick={() => onSubscribe(plan)} disabled={tier === 'lifetime'} className={`${featured ? 'btn-primary' : 'btn-secondary'} mt-6 justify-center`}>
                  Subscribe
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-xs text-smoke">Checkout here is a demonstration: use card 4242 4242 4242 4242. No payment processor is connected and no charge is made.</p>
    </section>
  );
}
