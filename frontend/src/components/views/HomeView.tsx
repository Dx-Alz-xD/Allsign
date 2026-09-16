'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardPaste, Gauge, Radio, type LucideIcon } from 'lucide-react';
import type { SystemState } from '@shared/types';
import { PitchModeDashboard } from '@/components/PitchModeDashboard';
import { useSimulatedHudSession } from '@/hooks/useSimulatedHudSession';
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

function SimulatedPitchDashboard() {
  const session = useSimulatedHudSession();
  return (
    <PitchModeDashboard
      source={session.source}
      peer={session.peer}
      grammar={session.grammar}
      isSimulated={session.isSimulated}
    />
  );
}

export function HomeView({ state }: { state: SystemState }) {
  if (state.activeProfile === 'pitch_demo') return <SimulatedPitchDashboard />;

  const preset = getProfilePreset(state.activeProfile);
  const Icon = preset.icon;
  const hasLatency = state.latencyMs > 0;

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
                : 'Your words stay in OmniVoice until you turn this on.'
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
            value={hasLatency ? `${state.latencyMs.toFixed(1)} ms` : 'No audio yet'}
            detail="Target is under 15 ms."
            live={hasLatency}
          />
        </dl>
      </section>
    </div>
  );
}
