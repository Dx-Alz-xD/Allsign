'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  CircleCheck,
  Cpu,
  Download,
  EyeOff,
  Info,
  Sparkles,
  Trash,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Modal, buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { api, backendUrl, getAuthToken } from '@/lib/api/client';
import { serverHost } from '@/lib/settings/network';
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/schema';
import { readStoredData } from '@/lib/settings/storage';
import { cn } from '@/lib/cn';

export const PRIVACY_LAST_UPDATED = '17 September 2026';

const COMMITMENTS: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Cpu,
    title: 'Your voice is analyzed on this computer',
    body: 'Pitch, strain, and fluency are measured on your computer as you speak. Audio is never recorded or uploaded, and grammar rules rebuild your sentences.',
  },
  {
    icon: UserRound,
    title: 'Your account keeps what you save',
    body: 'The Voicematics server stores your email, a password hash, your plan and licence, and the triggers, presets, session summaries, and therapy targets you save.',
  },
  {
    icon: Sparkles,
    title: 'AI only where you can see it',
    body: 'Only the second answer in ClearVoice sends text to an AI model (Google Gemini, or Groq if Gemini fails). Audio never does, and the second answer can be switched off.',
  },
  {
    icon: EyeOff,
    title: 'No tracking',
    body: 'No advertising IDs, usage analytics, or crash reports. See, download, or delete your data whenever you want.',
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
  const { geminiAnswer } = settings.speech;

  return useMemo(() => {
    const checks: DeviceCheck[] = [
      {
        label: 'Voice analysis',
        value: 'On this device',
        detail: 'Audio is analyzed in memory as you speak and is never saved as a recording.',
        tone: 'local',
      },
    ];

    // The same address the app actually calls: NEXT_PUBLIC_BACKEND_URL, or the local default.
    let server: DeviceCheck;
    try {
      const url = new URL(backendUrl());
      server = isLoopbackHost(url.hostname)
        ? {
            label: 'Voicematics server',
            value: `On this computer (${url.host})`,
            detail: 'Your account, saved data, and recognized words stay on this computer.',
            tone: 'local',
          }
        : {
            label: 'Voicematics server',
            value: url.host,
            detail: `Your account, the triggers, presets, and session summaries you save, and recognized words travel to it${
              url.protocol === 'https:' ? ', encrypted' : ' without encryption'
            }. Recognized words are rebuilt into sentences and not saved.`,
            tone: 'leaves-device',
          };
    } catch {
      server = { label: 'Voicematics server', value: 'Invalid address', detail: 'Nothing can be sent anywhere until this is fixed.', tone: 'info' };
    }
    checks.push(server);

    checks.push({
      label: 'Caregiver link, when you connect one',
      value: turnUrl ? `Direct, with ${serverHost(turnUrl)} as fallback relay` : 'Direct between devices',
      detail: `Alerts, readings, and rebuilt sentences you share go straight to the caregiver, encrypted. The Voicematics server only introduces the two devices and sees your account, the room code, and connection details such as IP addresses.${
        turnUrl
          ? ' If a direct path fails, the relay forwards the encrypted data and can also see connection details.'
          : ' No relay is configured.'
      }`,
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
      label: 'Second answer in ClearVoice',
      value: geminiAnswer ? 'On' : 'Off',
      detail: geminiAnswer
        ? 'Each rebuilt sentence’s words (never audio) and your last few sentences go to the Voicematics server, which asks Google Gemini, or Groq if Gemini fails, for a context-aware answer. Answers are not saved on the server. Switch it off next to the text box.'
        : 'Rebuilt sentences come from grammar rules only; nothing you say goes to an AI model.',
      tone: geminiAnswer ? 'leaves-device' : 'local',
    });

    checks.push({
      label: 'Analytics, tracking, and crash reports',
      value: 'None',
      detail:
        'No usage analytics, advertising IDs, or crash reports. Like any online service, the server may keep ordinary request logs, such as IP addresses and times, to keep it running.',
      tone: 'local',
    });

    return checks;
  }, [geminiAnswer, stunUrls, turnUrl]);
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

    // Everything saved with the account, when signed in. A part the plan does not include is simply left out.
    const token = getAuthToken();
    const settled = token
      ? await Promise.allSettled([
          api.auth.me(token),
          api.triggers.list({ limit: 500 }),
          api.presets.list(),
          api.sessions.list({ limit: 500 }),
          api.phonemes.targets(),
        ])
      : null;
    const value = (index: number) => (settled?.[index]?.status === 'fulfilled' ? settled[index].value : null);

    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'Voicematics',
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
      storedInThisApp: stored,
      globalShortcuts: shortcuts ?? null,
      account: settled
        ? { account: value(0), triggers: value(1), presets: value(2), sessions: value(3), phonemeTargets: value(4) }
        : null,
      notIncluded: token
        ? []
        : ['Account data: sign in to include your triggers, presets, sessions, and therapy targets.'],
    };

    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `voicematics-data-${new Date().toISOString().slice(0, 10)}.json`;
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
      description={`How Voicematics handles your voice and data. Last updated ${PRIVACY_LAST_UPDATED}.`}
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

        <Section id="privacy-what" title="What Voicematics handles">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Your account.</strong> Your email address, a salted Argon2id hash of your password (never the
              password itself), your plan, your licence key, the computer it is bound to (as a one-way hash), and the
              computers you stay signed in on. Checkout on the website keeps only the card brand and last four digits.
            </li>
            <li>
              <strong>Microphone audio.</strong> Processed in memory on your computer in real time to measure pitch, volume,
              and fluency. Raw audio is not recorded, saved, or uploaded.
            </li>
            <li>
              <strong>Voice measurements</strong> such as pitch, jitter, shimmer, and vocal strain. Shown live. With
              session analytics, session summaries (speaking rate, block counts, fluency) are saved to your account.
            </li>
            <li>
              <strong>Recognized words and reconstructed sentences.</strong> Sent to the Voicematics server to be rebuilt
              into sentences, not saved there, and typed into other apps only when you use direct paste.
            </li>
            <li>
              <strong>Custom triggers, presets, and therapy targets.</strong> Saved to your account. A trigger is a sound
              fingerprint of 128 numbers, which cannot be played back as audio.
            </li>
            <li>
              <strong>Settings</strong>, including display preferences, audio devices, shortcuts, and relay server
              credentials.
            </li>
          </ul>
        </Section>

        <Section id="privacy-where" title="Where your data is stored">
          <p>
            <strong>On the Voicematics server:</strong> your account, plan, and licence, and the triggers, presets, session
            summaries, and therapy targets you save. Only your account can read them.
          </p>
          <p>
            <strong>On this computer:</strong> settings and relay credentials in this app&apos;s storage, custom shortcuts in
            the app&apos;s data folder, and a sign-in token that works only on this computer, encrypted with your system
            keychain where one is available. Your password is never stored on this computer.
          </p>
        </Section>

        <Section id="privacy-leaves" title="When data leaves this device">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              While you are signed in, the app checks your plan with the Voicematics server every few minutes and saves the
              data listed above to your account.
            </li>
            <li>Recognized words go to the Voicematics server to be rebuilt into sentences.</li>
            <li>
              The second answer in ClearVoice is on. Each sentence&apos;s words and your last few sentences
              go to the Voicematics server and on to Google Gemini or Groq, whose own privacy terms apply to that request.
            </li>
            <li>
              You connect a caregiver. Shared alerts, readings, and rebuilt sentences travel encrypted between the two
              devices, through a relay only if a direct connection fails. The Voicematics server sets up the connection and
              sees the room code and IP addresses, never the shared data. Alerts you send from your phone&apos;s alert button
              are the exception: the server passes them to the caregiver, holding them up to 10 minutes if nobody is
              connected, and does not keep them afterwards.
            </li>
            <li>
              You use direct paste. The text becomes part of the app you paste into, such as Slack, Word, Zoom, or
              Discord, and that app&apos;s privacy policy applies to it.
            </li>
          </ul>
        </Section>

        <Section id="privacy-health" title="Health information, HIPAA, and GDPR">
          <p>
            Voice measurements can reveal health information, so Voicematics treats all of your data as sensitive.
          </p>
          <p>
            <strong>HIPAA.</strong> Voicematics stores account data on its server and is not offered as a HIPAA-covered
            service. If a clinic uses Voicematics with patients, the clinic remains responsible for its own HIPAA
            obligations, including deciding whether session data may be saved to Voicematics accounts and whether second
            answers may be written with a third-party AI provider.
          </p>
          <p>
            <strong>GDPR.</strong> Voicematics collects only what the features you use need, keeps it with your account,
            and supports your rights to access, export, correct, and erase it: download a copy below, delete sessions and
            triggers one by one in the app, or delete your whole account under Account.
          </p>
          <p>This is a description of how Voicematics works, not a certification or legal advice.</p>
        </Section>

        <section aria-labelledby="privacy-rights" className="space-y-3">
          <h3 id="privacy-rights" className="text-xl font-semibold text-ink">
            Your data, your choice
          </h3>
          <p className="max-w-prose leading-relaxed text-mist">
            Download a copy of everything Voicematics keeps in this app and, while you are signed in, in your account. Delete
            this computer&apos;s data below, or your account and everything saved with it under Account. You can also turn off
            microphone access for Voicematics in your system settings at any time.
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
