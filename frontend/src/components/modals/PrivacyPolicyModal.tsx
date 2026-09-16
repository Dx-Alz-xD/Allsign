'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  CircleCheck,
  CloudOff,
  Cpu,
  Download,
  EyeOff,
  Info,
  Scale,
  Trash,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Modal, buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { serverHost } from '@/lib/settings/network';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/schema';
import { readStoredData } from '@/lib/settings/storage';
import { cn } from '@/lib/cn';

export const PRIVACY_LAST_UPDATED = '16 September 2026';

const COMMITMENTS: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Cpu,
    title: '100% on-device processing',
    body: 'Voice analysis, grammar rules, and sentence reconstruction run on your own computers. No cloud AI or speech service ever receives your voice.',
  },
  {
    icon: CloudOff,
    title: 'Zero cloud data persistence',
    body: 'There are no accounts and no cloud database. Settings, custom triggers, and session analytics stay in files on your devices.',
  },
  {
    icon: EyeOff,
    title: 'Zero telemetry tracking',
    body: 'No analytics, advertising IDs, crash reports, or usage tracking. OmniVoice OS has no server of its own to send them to.',
  },
  {
    icon: Scale,
    title: 'HIPAA and GDPR alignment',
    body: 'Designed around data minimization, local storage, encryption in transit, and your rights to see, export, and erase your data.',
  },
];

type CheckTone = 'local' | 'leaves-device' | 'info';

interface DeviceCheck {
  label: string;
  value: string;
  detail: string;
  tone: CheckTone;
}

const TONE_ICONS: Record<CheckTone, { icon: LucideIcon; className: string; srLabel: string }> = {
  local: { icon: CircleCheck, className: 'text-neon-cyan', srLabel: 'Stays on this device.' },
  'leaves-device': { icon: TriangleAlert, className: 'text-warn', srLabel: 'Data leaves this device.' },
  info: { icon: Info, className: 'text-neon-blue', srLabel: 'For your information.' },
};

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host);
}

function useDeviceChecks(): DeviceCheck[] {
  const { settings } = useSettings();
  const { stunUrls, turnUrl } = settings.network;

  return useMemo(() => {
    const checks: DeviceCheck[] = [
      {
        label: 'Voice analysis',
        value: 'On this device',
        detail: 'Audio is analyzed in memory as you speak and is never saved as a recording.',
        tone: 'local',
      },
    ];

    const backend = process.env.NEXT_PUBLIC_BACKEND_URL;
    let grammar: DeviceCheck = {
      label: 'Grammar server',
      value: 'Not set',
      detail: 'Recognized words are not sent anywhere.',
      tone: 'local',
    };
    if (backend) {
      try {
        const url = new URL(backend);
        grammar = isLoopbackHost(url.hostname)
          ? { label: 'Grammar server', value: `On this device (${url.host})`, detail: 'Recognized words stay on this computer.', tone: 'local' }
          : {
              label: 'Grammar server',
              value: `Another computer (${url.host})`,
              detail: `Recognized words travel over your network to that computer${url.protocol === 'https:' ? ', encrypted' : ' without encryption'}. Use a server you control.`,
              tone: 'leaves-device',
            };
      } catch {
        grammar = { label: 'Grammar server', value: 'Invalid address', detail: 'Recognized words cannot be sent anywhere until this is fixed.', tone: 'info' };
      }
    }
    checks.push(grammar);

    checks.push({
      label: 'Caregiver link, when you connect one',
      value: turnUrl ? `Direct, with ${serverHost(turnUrl)} as fallback relay` : 'Direct between devices',
      detail: turnUrl
        ? 'Alerts and readings you share go straight to the caregiver, encrypted. If a direct path fails, the relay forwards the encrypted data and can see connection details such as IP addresses.'
        : 'Alerts and readings you share go straight to the caregiver, encrypted. No relay is configured.',
      tone: turnUrl ? 'leaves-device' : 'info',
    });

    checks.push({
      label: 'Connection helper (STUN)',
      value: stunUrls.length > 0 ? stunUrls.map(serverHost).join(', ') : 'None',
      detail:
        stunUrls.length > 0
          ? 'When a caregiver link starts, this server sees your public IP address so the devices can find each other. Nothing else is sent to it.'
          : 'No server sees your IP address, but caregiver links may fail to connect across networks.',
      tone: 'info',
    });

    checks.push({
      label: 'Analytics, tracking, and crash reports',
      value: 'None',
      detail: 'Nothing about how you use OmniVoice OS is collected or sent.',
      tone: 'local',
    });

    return checks;
  }, [stunUrls, turnUrl]);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-xl font-semibold text-ink">
        {title}
      </h3>
      <div className="max-w-prose space-y-3 leading-relaxed text-mist [&_strong]:font-bold [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}

function DataControls() {
  const { eraseLocalData } = useSettings();
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [message, setMessage] = useState('');

  const downloadCopy = async () => {
    const stored = readStoredData();
    const settings = stored[SETTINGS_STORAGE_KEY] as { network?: { turnCredential?: string } } | undefined;
    if (settings?.network?.turnCredential) {
      settings.network.turnCredential = '(saved on this device, left out of exports)';
    }
    const shortcuts = await window.omnivoice?.hotkeys
      .getStatus()
      .then((status) => status.registrations.map(({ action, label, accelerator }) => ({ action, label, accelerator })))
      .catch(() => null);

    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'OmniVoice OS',
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
      storedInThisApp: stored,
      globalShortcuts: shortcuts ?? null,
      notIncluded: [
        'Custom triggers and session analytics live in omnivoice.db on the computer running the grammar server.',
      ],
    };

    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `omnivoice-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    setMessage('Your data file is ready. Choose where to save it.');
  };

  const erase = async () => {
    const removed = eraseLocalData();
    let shortcutsReset = false;
    const bridge = window.omnivoice;
    if (bridge) {
      try {
        await bridge.hotkeys.reset();
        shortcutsReset = true;
      } catch {
        shortcutsReset = false;
      }
    }
    setConfirmingErase(false);
    setMessage(
      `Deleted ${removed.length === 1 ? '1 saved item' : `${removed.length} saved items`} from this device${
        shortcutsReset ? ' and restored the default shortcuts' : ''
      }. Settings are back to their defaults.`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void downloadCopy()} className={buttonStyles.secondary}>
          <Download aria-hidden className="size-4" />
          Download a copy of my data
        </button>
        {!confirmingErase && (
          <button type="button" onClick={() => setConfirmingErase(true)} className={buttonStyles.secondary}>
            <Trash aria-hidden className="size-4" />
            Delete my data from this device
          </button>
        )}
      </div>

      {confirmingErase && (
        <div role="group" aria-label="Confirm deletion" className="rounded-xl border border-warn/60 bg-warn/[0.07] p-4">
          <p className="max-w-prose text-ink">
            This deletes your settings, saved relay credentials, custom shortcuts, and terms acknowledgement from this
            device. It cannot be undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void erase()} className={buttonStyles.danger}>
              Delete everything
            </button>
            <button type="button" onClick={() => setConfirmingErase(false)} className={buttonStyles.secondary}>
              Keep my data
            </button>
          </div>
        </div>
      )}

      <p aria-live="polite" className="min-h-6 text-sm text-mist">
        {message}
      </p>
    </div>
  );
}

export function PrivacyPolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const checks = useDeviceChecks();
  const { openModal } = useModals();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Privacy policy"
      description={`How OmniVoice OS handles your voice and data. Last updated ${PRIVACY_LAST_UPDATED}.`}
      size="lg"
      footer={
        <button type="button" onClick={onClose} className={buttonStyles.primary}>
          Done
        </button>
      }
    >
      <div className="space-y-10">
        <ul className="grid gap-3 sm:grid-cols-2">
          {COMMITMENTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-xl border border-neon-cyan/30 bg-neon-cyan/[0.05] p-4">
              <p className="flex items-center gap-2.5 font-display text-lg font-semibold text-ink">
                <Icon aria-hidden className="size-5 shrink-0 text-neon-cyan" />
                {title}
              </p>
              <p className="mt-2 leading-relaxed text-mist">{body}</p>
            </li>
          ))}
        </ul>

        <section aria-labelledby="privacy-device-check" className="space-y-3">
          <h3 id="privacy-device-check" className="text-xl font-semibold text-ink">
            On this device right now
          </h3>
          <p className="max-w-prose text-mist">Checked against your current settings, so this list is always accurate.</p>
          <dl className="divide-y divide-white/10 rounded-xl border border-white/10">
            {checks.map((check) => {
              const tone = TONE_ICONS[check.tone];
              return (
                <div key={check.label} className="flex gap-3 px-4 py-3">
                  <tone.icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', tone.className)} />
                  <div className="min-w-0">
                    <dt className="text-sm text-mist">{check.label}</dt>
                    <dd className="font-display text-lg font-semibold text-ink [overflow-wrap:anywhere]">
                      {check.value}
                      <span className="sr-only"> {tone.srLabel}</span>
                    </dd>
                    <dd className="mt-0.5 max-w-prose text-sm leading-relaxed text-mist">{check.detail}</dd>
                  </div>
                </div>
              );
            })}
          </dl>
          <button type="button" onClick={() => openModal({ kind: 'settings', tab: 'network' })} className={buttonStyles.link}>
            Change network servers
          </button>
        </section>

        <Section id="privacy-what" title="What OmniVoice OS handles">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Microphone audio.</strong> Processed in memory in real time to measure pitch, volume, and fluency.
              Raw audio is not recorded or saved.
            </li>
            <li>
              <strong>Voice measurements</strong> such as pitch, jitter, shimmer, and vocal strain. Shown live; only
              session summaries (speaking rate, block counts, fluency) are saved, and only on your devices.
            </li>
            <li>
              <strong>Recognized words and reconstructed sentences.</strong> Sent to the grammar server you configure,
              and typed into other apps only when you use direct paste.
            </li>
            <li>
              <strong>Custom triggers.</strong> A sound fingerprint of 128 numbers for each sound you teach OmniVoice OS.
              A fingerprint cannot be played back as audio.
            </li>
            <li>
              <strong>Settings</strong>, including display preferences, audio devices, shortcuts, and relay server
              credentials.
            </li>
          </ul>
        </Section>

        <Section id="privacy-where" title="Where your data is stored">
          <p>
            Settings and relay credentials are saved in this app&apos;s storage on this device. Custom shortcuts are saved in
            the app&apos;s data folder. Custom triggers and session analytics are saved in <strong>omnivoice.db</strong> on the
            computer that runs the grammar server. Nothing is stored anywhere else.
          </p>
        </Section>

        <Section id="privacy-leaves" title="When data leaves this device">
          <p>Only in these cases, and only because you set them up:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Your grammar server runs on another computer. The check above tells you if it does.</li>
            <li>
              You connect a caregiver. Shared alerts and readings travel encrypted between the two devices, through a
              relay only if a direct connection fails.
            </li>
            <li>
              You use direct paste. The text becomes part of the app you paste into, such as Slack, Word, Zoom, or
              Discord, and that app&apos;s privacy policy applies to it.
            </li>
          </ul>
        </Section>

        <Section id="privacy-health" title="Health information, HIPAA, and GDPR">
          <p>
            Voice measurements can reveal health information, so OmniVoice OS treats all of your data as sensitive.
          </p>
          <p>
            <strong>HIPAA.</strong> OmniVoice OS never receives your data, so its makers do not act as a covered entity or
            business associate. If a clinic uses OmniVoice OS with patients, the clinic remains responsible for its own
            HIPAA obligations. The design supports them: data stays on devices the clinic controls, and caregiver
            connections are encrypted.
          </p>
          <p>
            <strong>GDPR.</strong> Processing happens on your device, under your control. OmniVoice OS follows the GDPR
            principles of data minimization, purpose limitation, storage limitation, and integrity and confidentiality,
            and supports your rights to access, export, and erase your data below.
          </p>
          <p>This alignment is a design commitment, not a certification or legal advice.</p>
        </Section>

        <section aria-labelledby="privacy-rights" className="space-y-3">
          <h3 id="privacy-rights" className="text-xl font-semibold text-ink">
            Your data, your choice
          </h3>
          <p className="max-w-prose leading-relaxed text-mist">
            Download everything OmniVoice OS stores in this app, or delete it. To remove custom triggers and session
            analytics as well, delete omnivoice.db on the computer running the grammar server. You can also turn off
            microphone access for OmniVoice OS in your system settings at any time.
          </p>
          <DataControls />
        </section>

        <Section id="privacy-changes" title="Changes to this policy">
          <p>
            When this policy changes, the date at the top changes too. See also the{' '}
            <button type="button" onClick={() => openModal({ kind: 'terms' })} className={buttonStyles.link}>
              terms of service
            </button>
            .
          </p>
        </Section>
      </div>
    </Modal>
  );
}
