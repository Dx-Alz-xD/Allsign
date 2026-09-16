import type { LucideIcon } from 'lucide-react';
import { Accessibility, ChartNoAxesColumn, House, Radio, Settings, Zap } from 'lucide-react';

export type ViewId = 'home' | 'analytics' | 'triggers' | 'caregiver' | 'settings' | 'accessibility';

export interface NavItem {
  id: ViewId;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    description: 'Your active profile and live connection status.',
    icon: House,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Speaking rate, blocks, and fluency across your sessions.',
    icon: ChartNoAxesColumn,
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
    id: 'settings',
    label: 'Settings',
    description: 'Direct paste, global shortcuts, and connection details for this device.',
    icon: Settings,
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    description: 'How OmniVoice adapts to the way you use it.',
    icon: Accessibility,
  },
];
