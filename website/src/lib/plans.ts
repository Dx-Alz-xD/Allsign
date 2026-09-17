import type { PricingPlan } from '@shared/types';

/** Shown until the backend answers, and when it is offline. Kept identical to routers/billing.py. */
export const FALLBACK_PLANS: PricingPlan[] = [
  { id: 'free', tier: 'free', name: 'Free', priceCents: 0, billingPeriod: null, features: ['ClearVoice: on-device recognition, grammar and direct paste', 'Sensory HUD', 'One gesture'] },
  { id: 'pro_monthly', tier: 'pro', name: 'Pro Monthly', priceCents: 1499, billingPeriod: 'monthly', features: ['Everything in Free', 'DAF / FSF Fluency Coach', 'Therapy vowel plane', 'Unlimited gestures', 'Caregiver link with approvals and phone alerts', 'Session analytics'] },
  { id: 'pro_annual', tier: 'pro', name: 'Pro Annual', priceCents: 12900, billingPeriod: 'annual', features: ['Everything in Pro Monthly', 'Two months free', 'Priority support'] },
  { id: 'lifetime', tier: 'lifetime', name: 'Lifetime Access', priceCents: 29900, billingPeriod: 'lifetime', features: ['Everything in Pro', 'One payment, every future release', 'Licence bound to your machine, transferable on request'] },
];

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export function periodLabel(plan: PricingPlan): string {
  switch (plan.billingPeriod) {
    case 'monthly':
      return '/mo';
    case 'annual':
      return '/yr';
    case 'lifetime':
      return ' once';
    default:
      return '';
  }
}
