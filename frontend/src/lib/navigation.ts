import type { LucideIcon } from 'lucide-react';
import { Accessibility, ChartNoAxesColumn, CircleUserRound, Radio, Settings } from 'lucide-react';
import type { Feature, ProfileMode } from '@shared/types';
import { PROFILE_FEATURE } from '@/lib/account/plans';
import { PROFILE_PRESETS, type ProfilePreset } from '@/lib/profiles';

export type ViewId = 'home' | 'analytics' | 'triggers' | 'caregiver' | 'account' | 'settings' | 'accessibility';

export interface NavItem {
  id: ViewId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Marked with a Pro badge when the plan does not include it. */
  feature?: Feature;
}

/** A mode in the sidebar: choosing it sets the profile and opens its view. */
export interface ModeItem {
  profile: ProfileMode;
  label: string;
  description: string;
  icon: LucideIcon;
  view: Extract<ViewId, 'home' | 'triggers'>;
  feature: Feature | null;
}

function mode(preset: ProfilePreset, view: ModeItem['view'] = 'home'): ModeItem {
  return { profile: preset.id, label: preset.label, description: preset.description, icon: preset.icon, view, feature: PROFILE_FEATURE[preset.id] };
}

/** The modes, in the order they appear. Gesture Trainer is the trigger workshop and the Vocal Assist profile in one. */
export const MODE_ITEMS: readonly ModeItem[] = PROFILE_PRESETS.map((preset) => mode(preset, preset.id === 'vocal_assist' ? 'triggers' : 'home'));

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Speaking rate, blocks and fluency across your sessions.',
    icon: ChartNoAxesColumn,
    feature: 'analytics',
  },
  {
    id: 'caregiver',
    label: 'Caregiver Link',
    description: 'Share live telemetry and alerts with a trusted device, or watch a speaker as their caregiver.',
    icon: Radio,
  },
  {
    id: 'account',
    label: 'Account',
    description: 'Your plan, your licence, and this computer.',
    icon: CircleUserRound,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Direct paste, global shortcuts, and connection details for this device.',
    icon: Settings,
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    description: 'How Voicematics adapts to the way you use it.',
    icon: Accessibility,
  },
];

/** The sidebar entry a (view, profile) pair belongs to, for the page heading and the active highlight. */
export function currentEntry(view: ViewId, profile: ProfileMode): { label: string; description: string } {
  if (view === 'home' || view === 'triggers') {
    const item = MODE_ITEMS.find((candidate) => (view === 'triggers' ? candidate.view === 'triggers' : candidate.profile === profile));
    if (item) return item;
  }
  return NAV_ITEMS.find((item) => item.id === view) ?? NAV_ITEMS[0];
}
