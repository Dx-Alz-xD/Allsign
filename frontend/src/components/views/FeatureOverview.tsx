'use client';

import {
  ChartNoAxesColumn,
  ClipboardPaste,
  FileText,
  Radio,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Feature, ProfileMode } from '@shared/types';
import { ProBadge } from '@/components/account/PlanGate';
import { useAccount } from '@/components/providers/AccountProvider';
import { PROFILE_FEATURE } from '@/lib/account/plans';
import type { ViewId } from '@/lib/navigation';
import { PROFILE_PRESETS } from '@/lib/profiles';
import { cn } from '@/lib/cn';

interface ToolEntry {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  view: ViewId;
  feature: Feature | null;
  /** Shown instead of the Pro badge when part of the tool is free. */
  freeNote?: string;
}

const TOOLS: readonly ToolEntry[] = [
  {
    id: 'triggers',
    label: 'Custom triggers',
    description: 'Teach Voicematics a sound you can make, and it speaks, types, alerts or presses a shortcut for you.',
    icon: Zap,
    view: 'triggers',
    feature: 'vocal_assist',
  },
  {
    id: 'paste',
    label: 'Direct paste and shortcuts',
    description: 'Rebuilt sentences are typed into the app you are using; global shortcuts work from anywhere.',
    icon: ClipboardPaste,
    view: 'settings',
    feature: null,
  },
  {
    id: 'caregiver',
    label: 'Caregiver Link',
    description: 'Share live voice measurements, sentences and emergency alerts with a trusted device.',
    icon: Radio,
    view: 'caregiver',
    feature: 'caregiver_link',
    freeNote: 'Watching is free',
  },
  {
    id: 'analytics',
    label: 'Session analytics',
    description: 'Speaking rate, blocks and fluency, saved for every session so you can see the trend.',
    icon: ChartNoAxesColumn,
    view: 'analytics',
    feature: 'analytics',
  },
  {
    id: 'reports',
    label: 'Clinical reports',
    description: 'A summary of a session’s voice measurements to share with your speech-language pathologist.',
    icon: FileText,
    view: 'analytics',
    feature: 'clinical_reports',
  },
];

interface FeatureOverviewProps {
  activeProfile: ProfileMode;
  onProfileChange: (profile: ProfileMode) => void;
  onSelectView: (view: ViewId) => void;
}

function Row({
  icon: Icon,
  label,
  description,
  locked,
  note,
  current,
  action,
  onAction,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  locked: boolean;
  note?: string;
  current?: boolean;
  action: string;
  onAction: () => void;
}) {
  return (
    <li className="flex items-start gap-3 py-3.5">
      <Icon aria-hidden className={cn('mt-1 size-5 shrink-0', current ? 'text-neon-cyan' : 'text-neon-blue')} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[1.05rem] font-semibold text-ink">{label}</span>
          {locked && !note && <ProBadge />}
          {locked && note && <span className="text-sm text-mist">{note}; sharing needs Pro</span>}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-mist">{description}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={current}
        aria-label={`${action}: ${label}`}
        className="mt-0.5 h-9 shrink-0 rounded-lg border border-white/15 px-3 font-display text-sm font-semibold text-ink transition-colors hover:bg-white/10 disabled:border-neon-cyan/40 disabled:text-neon-cyan disabled:hover:bg-transparent"
      >
        {current ? 'In use' : action}
      </button>
    </li>
  );
}

/** Every profile and tool in one place, with what the plan includes. */
export function FeatureOverview({ activeProfile, onProfileChange, onSelectView }: FeatureOverviewProps) {
  const { has } = useAccount();

  return (
    <section aria-labelledby="features-heading" className="glass rounded-2xl p-5">
      <h2 id="features-heading" className="text-xl font-semibold text-ink">
        Everything in Voicematics
      </h2>
      <p className="mt-1 max-w-prose text-mist">
        Profiles change what the app does while you speak. Pro features show what they do and how to unlock them when you open
        them.
      </p>
      <div className="mt-2 grid gap-x-8 lg:grid-cols-2">
        <div>
          <h3 className="mt-3 text-sm font-bold text-mist">Profiles</h3>
          <ul className="divide-y divide-white/[0.07]">
            {PROFILE_PRESETS.map((preset) => (
              <Row
                key={preset.id}
                icon={preset.icon}
                label={preset.label}
                description={preset.description}
                locked={!has(PROFILE_FEATURE[preset.id])}
                current={preset.id === activeProfile}
                action="Switch"
                onAction={() => onProfileChange(preset.id)}
              />
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mt-3 text-sm font-bold text-mist">Tools</h3>
          <ul className="divide-y divide-white/[0.07]">
            {TOOLS.map((tool) => (
              <Row
                key={tool.id}
                icon={tool.icon}
                label={tool.label}
                description={tool.description}
                locked={!has(tool.feature)}
                note={tool.freeNote}
                action="Open"
                onAction={() => onSelectView(tool.view)}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
