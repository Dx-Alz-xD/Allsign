import type { LucideIcon } from 'lucide-react';
import { Accessibility, ChartNoAxesColumn, CircleUserRound, House, Radio, Settings, Zap } from 'lucide-react';
import type { Feature } from '@shared/types';

export type ViewId = 'home' | 'analytics' | 'triggers' | 'caregiver' | 'account' | 'settings' | 'accessibility';

export interface NavItem {
  id: ViewId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Marked with a Pro badge when the plan does not include it. */
  feature?: Feature;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    description: 'Your active profile, live status, and everything Voicematics can do.',
    icon: House,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Speaking rate, blocks, and fluency across your sessions, and clinical reports.',
    icon: ChartNoAxesColumn,
    feature: 'analytics',
  },
  {
    id: 'triggers',
    label: 'Custom Triggers',
    description: 'Sounds you can make, linked to phrases or actions.',
    icon: Zap,
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
