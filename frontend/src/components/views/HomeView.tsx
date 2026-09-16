'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardPaste, Gauge, Radio, type LucideIcon } from 'lucide-react';
import type { ProfileMode, SystemState } from '@shared/types';
import { LockedFeature } from '@/components/account/PlanGate';
import { PitchModeDashboard } from '@/components/PitchModeDashboard';
import { AphasiaPanel } from '@/components/profiles/AphasiaPanel';
import { ClearVoicePanel } from '@/components/profiles/ClearVoicePanel';
import { FluencyPanel } from '@/components/profiles/FluencyPanel';
import { SensoryPanel } from '@/components/profiles/SensoryPanel';
import { TherapyPanel } from '@/components/profiles/TherapyPanel';
import { VocalAssistPanel } from '@/components/profiles/VocalAssistPanel';
import { useAccount } from '@/components/providers/AccountProvider';
import { useSession } from '@/components/providers/SessionProvider';
import { FeatureOverview } from '@/components/views/FeatureOverview';
import { PROFILE_FEATURE } from '@/lib/account/plans';
import type { ViewId } from '@/lib/navigation';
import { getProfilePreset } from '@/lib/profiles';
import { cn } from '@/lib/cn';

interface StatusItemProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  live?: boolean;
}

function StatusItem({ icon: Icon, label, value, detail, live = false }: StatusItemProps) {
  return (
    <div className="flex gap-3 px-5 py-4">
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', live ? 'text-neon-cyan' : 'text-dim')} />
      <div className="min-w-0">
        <dt className="text-sm text-mist">{label}</dt>
        <dd className="mt-0.5 font-display text-lg font-semibold text-ink">{value}</dd>
        <dd className="mt-1 text-sm text-mist">{detail}</dd>
      </div>
    </div>
  );
}

function LivePitchDashboard() {
  const session = useSession();
  return (
    <PitchModeDashboard
      source={session.isSimulated ? session.demoTelemetry : session.telemetry}
      peer={session.peer}
      grammar={session.grammar}
      grammarSource={session.grammarSource}
      grammarRoundTripMs={session.grammarRoundTripMs}
      astBudgetMs={session.astBudgetMs}
      isSimulated={session.isSimulated}
    />
  );
}

/** What a locked profile adds, beyond the one-line description already shown above it. */
const LOCKED_PROFILE_DETAILS: Partial<Record<ProfileMode, string>> = {
  fluency:
    'Delayed and frequency-shifted auditory feedback play your voice back to you up to 150 ms late or slightly higher or lower, which helps many people who stutter speak more smoothly. Save the settings that work as presets.',
  therapy:
    'Practise vowels on a live vowel chart with an accuracy score for every attempt, and add your own articulation targets from your voice.',
};

interface HomeViewProps {
  state: SystemState;
  onProfileChange: (profile: ProfileMode) => void;
  onSelectView: (view: ViewId) => void;
}

export function HomeView({ state, onProfileChange, onSelectView }: HomeViewProps) {
  const { has } = useAccount();
  if (state.activeProfile === 'pitch_demo') return <LivePitchDashboard />;

  const preset = getProfilePreset(state.activeProfile);
  const Icon = preset.icon;
  const hasLatency = state.latencyMs > 0;
  const requiredFeature = PROFILE_FEATURE[state.activeProfile];
  const unlocked = has(requiredFeature);

  return (
    <div className="space-y-6">
      <section aria-label="Active profile" className="rounded-3xl bg-neon-edge p-px shadow-neon">
        <div className="rounded-[calc(1.5rem-1px)] bg-void/90 p-6 backdrop-blur-xl sm:p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={preset.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7"
            >
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-neon-cyan/10 ring-1 ring-neon-cyan/40 sm:size-20">
                <Icon aria-hidden className="size-8 text-neon-cyan sm:size-10" />
              </span>
              <div className="min-w-0">
                <h2 className="text-3xl font-bold text-ink sm:text-5xl">{preset.label}</h2>
                <p className="mt-3 max-w-prose text-lg leading-relaxed text-mist">{preset.description}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {!unlocked && requiredFeature && (
        <LockedFeature feature={requiredFeature}>
          <p>{LOCKED_PROFILE_DETAILS[state.activeProfile] ?? preset.description}</p>
        </LockedFeature>
      )}
      {unlocked && state.activeProfile === 'clearvoice' && <ClearVoicePanel />}
      {unlocked && state.activeProfile === 'fluency' && <FluencyPanel />}
      {unlocked && state.activeProfile === 'vocal_assist' && <VocalAssistPanel />}
      {unlocked && state.activeProfile === 'therapy' && <TherapyPanel />}
      {unlocked && state.activeProfile === 'aphasia' && <AphasiaPanel />}
      {unlocked && state.activeProfile === 'sensory' && <SensoryPanel />}

      <section aria-labelledby="status-heading" className="glass rounded-2xl">
        <h2 id="status-heading" className="px-5 pt-4 text-base font-semibold text-ink">
          Status
        </h2>
        <dl className="grid divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <StatusItem
            icon={ClipboardPaste}
            label="Direct paste"
            value={state.isDirectPasteActive ? 'On' : 'Off'}
            detail={
              state.isDirectPasteActive
                ? 'Your words are typed into the app you are using.'
                : 'Your words stay in Voicematics until you turn this on.'
            }
            live={state.isDirectPasteActive}
          />
          <StatusItem
            icon={Radio}
            label="Remote connection"
            value={state.webRtcPeerConnected ? 'Connected' : 'Not connected'}
            detail={
              state.webRtcPeerConnected
                ? 'Alerts are shared with a connected device.'
                : 'No device is connected for live alerts.'
            }
            live={state.webRtcPeerConnected}
          />
          <StatusItem
            icon={Gauge}
            label="Processing latency"
            value={hasLatency ? `${state.latencyMs.toFixed(2)} ms` : 'No audio yet'}
            detail="Per analysis frame. Target is under 15 ms."
            live={hasLatency}
          />
        </dl>
      </section>

      <FeatureOverview activeProfile={state.activeProfile} onProfileChange={onProfileChange} onSelectView={onSelectView} />
    </div>
  );
}
