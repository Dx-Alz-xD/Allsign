import type { Entitlements, Feature, ProfileMode } from '@shared/types';

/**
 * What each Voicematics plan unlocks, for gating the UI. The backend decides (backend/web_auth/plans.py) and
 * enforces it; this mirror only picks what to show before the account has loaded and where a feature lives.
 */

export const FREE_FEATURES: readonly Feature[] = ['clearvoice', 'aphasia', 'sensory', 'vocal_assist'];
export const FREE_TRIGGER_LIMIT = 1;

export const FREE_ENTITLEMENTS: Entitlements = {
  tier: 'free',
  features: [...FREE_FEATURES],
  triggerLimit: FREE_TRIGGER_LIMIT,
  expiresAt: null,
};

export const FEATURE_NAMES: Record<Feature, string> = {
  clearvoice: 'ClearVoice',
  aphasia: 'Aphasia Mode',
  sensory: 'Sensory HUD',
  vocal_assist: 'Vocal Assist triggers',
  fluency: 'Fluency Coach',
  therapy: 'Therapy Mode',
  unlimited_triggers: 'Unlimited triggers',
  caregiver_link: 'Caregiver Link',
  analytics: 'Session analytics',
  clinical_reports: 'Clinical reports',
};

/** The plan feature behind each profile; Pitch Demo is open to everyone. Mirrors PROFILE_FEATURES in plans.py. */
export const PROFILE_FEATURE: Record<ProfileMode, Feature | null> = {
  clearvoice: 'clearvoice',
  fluency: 'fluency',
  vocal_assist: 'vocal_assist',
  therapy: 'therapy',
  aphasia: 'aphasia',
  sensory: 'sensory',
  pitch_demo: null,
};

export const PLAN_NAMES: Record<Entitlements['tier'], string> = {
  free: 'Free',
  pro: 'Pro',
  lifetime: 'Lifetime',
};

export function hasFeature(entitlements: Entitlements, feature: Feature | null): boolean {
  return feature === null || entitlements.features.includes(feature);
}

// The website runs the pricing page and checkout; the desktop app never takes payment itself.
const DEFAULT_WEBSITE_URL = 'http://localhost:3100';

export function websiteUrl(hash = ''): string {
  const base = (process.env.NEXT_PUBLIC_WEBSITE_URL || DEFAULT_WEBSITE_URL).replace(/\/+$/, '');
  return `${base}/${hash}`;
}

/** Opens the website in the system browser (the desktop shell hands http(s) windows to the OS). */
export function openWebsite(hash = ''): void {
  window.open(websiteUrl(hash), '_blank', 'noopener');
}
