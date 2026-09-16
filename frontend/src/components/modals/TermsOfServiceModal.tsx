'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CircleCheck, Siren } from 'lucide-react';
import { Modal, buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { TERMS_VERSION } from '@/lib/settings/schema';

export const TERMS_LAST_UPDATED = '16 September 2026';

export type TermsSection = 'medical' | 'emergency' | 'accessibility';

const KEY_POINTS: readonly string[] = [
  'OmniVoice OS is an assistive communication tool, not a medical device.',
  'It does not diagnose, treat, or monitor any health condition.',
  'The emergency alert does not contact emergency services.',
  'Check reconstructed text before you send it.',
  'You have the right to use OmniVoice OS in whatever way works for you, with any assistive technology.',
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-4 space-y-3">
      <h3 id={`${id}-heading`} className="text-xl font-semibold text-ink">
        {title}
      </h3>
      <div className="max-w-prose space-y-3 leading-relaxed text-mist [&_strong]:font-bold [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

interface TermsOfServiceModalProps {
  open: boolean;
  onClose: () => void;
  /** Scrolls to this section when the modal opens. */
  section?: TermsSection;
}

export function TermsOfServiceModal({ open, onClose, section }: TermsOfServiceModalProps) {
  const { settings, updateLegal } = useSettings();
  const { openModal } = useModals();
  const bodyRef = useRef<HTMLDivElement>(null);

  const acknowledged = settings.legal.termsVersion === TERMS_VERSION && settings.legal.termsAcknowledgedAt !== null;

  useEffect(() => {
    if (!open || !section) return;
    const frame = requestAnimationFrame(() => {
      bodyRef.current?.querySelector(`#terms-${section}`)?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, section]);

  const acknowledge = () => {
    updateLegal({ termsVersion: TERMS_VERSION, termsAcknowledgedAt: new Date().toISOString() });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Terms of service"
      description={`The rules for using OmniVoice OS and the rights you keep. Last updated ${TERMS_LAST_UPDATED}.`}
      size="lg"
      bodyRef={bodyRef}
      footer={
        <>
          <p aria-live="polite" className="mr-auto flex items-center gap-2 text-sm text-mist">
            {acknowledged && settings.legal.termsAcknowledgedAt && (
              <>
                <CircleCheck aria-hidden className="size-4 text-neon-cyan" />
                You acknowledged these terms on {formatDate(settings.legal.termsAcknowledgedAt)}.
              </>
            )}
          </p>
          {!acknowledged && (
            <button type="button" onClick={acknowledge} className={buttonStyles.primary}>
              I understand
            </button>
          )}
          <button type="button" onClick={onClose} className={acknowledged ? buttonStyles.primary : buttonStyles.secondary}>
            Close
          </button>
        </>
      }
    >
      <div className="space-y-10">
        <section aria-labelledby="terms-summary" className="rounded-xl border border-neon-cyan/30 bg-neon-cyan/[0.05] p-4 sm:p-5">
          <h3 id="terms-summary" className="text-xl font-semibold text-ink">
            In plain language
          </h3>
          <ul className="mt-3 max-w-prose space-y-2">
            {KEY_POINTS.map((point) => (
              <li key={point} className="flex gap-2.5 leading-relaxed text-ink">
                <CircleCheck aria-hidden className="mt-1 size-4 shrink-0 text-neon-cyan" />
                {point}
              </li>
            ))}
          </ul>
        </section>

        <Section id="terms-medical" title="Not a medical device">
          <p>
            OmniVoice OS is not a medical device and has not been cleared or approved by the FDA, CE marked, or reviewed
            by any other medical regulator.
          </p>
          <p>
            Measurements such as pitch, jitter, shimmer, harmonics-to-noise ratio, vocal strain, fluency, and speaking
            rate are approximate indicators for your own awareness. They are not clinical assessments. Do not use them to
            diagnose a condition, make treatment decisions, or replace care from a speech-language pathologist, doctor,
            or other licensed professional.
          </p>
          <p>
            Therapy, fluency, and breathing features are practice aids that can support professional care, not replace
            it. <strong>Stop using a breathing or voice feedback feature</strong> if you feel dizzy, short of breath,
            uncomfortable, or anxious, and talk to your clinician before continuing.
          </p>
        </Section>

        <Section id="terms-emergency" title="Emergency alerts">
          <div className="flex gap-3 rounded-xl border-2 border-warn bg-warn/[0.08] p-4">
            <Siren aria-hidden className="mt-0.5 size-6 shrink-0 text-warn" />
            <p className="text-ink">
              <strong>The emergency alert does not call emergency services.</strong> In an emergency, call your local
              emergency number, such as 911, 112, or 999.
            </p>
          </div>
          <p>
            The alert shows a message on screen, can read it aloud, and can notify a connected caregiver. Caregiver alerts
            depend on your network, any relay server, and the caregiver&apos;s device, so they can be delayed or fail. Do not
            rely on OmniVoice OS as your only way to get help.
          </p>
        </Section>

        <Section id="terms-text" title="Reconstructed text and direct paste">
          <p>
            Grammar reconstruction follows fixed rules and can misread speech or change what you meant. Review the text
            before you send it, especially for medical, legal, or financial matters. You are responsible for messages you
            send.
          </p>
          <p>
            Direct paste types into whichever app is active. Check that the right window is in front before you use it.
          </p>
        </Section>

        <Section id="terms-accessibility" title="Your accessibility rights">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Accessible by design.</strong> OmniVoice OS aims to meet WCAG 2.1 Level AA. Controls work with a
              keyboard and are labelled for screen readers, and live visuals have text equivalents.
            </li>
            <li>
              <strong>Adjust it to your needs.</strong> Turn on high contrast, enlarge text up to 200%, and change the
              global shortcuts. Animations follow your system&apos;s reduce-motion setting.{' '}
              <button type="button" onClick={() => openModal({ kind: 'settings', tab: 'display' })} className={buttonStyles.link}>
                Open display settings
              </button>
            </li>
            <li>
              <strong>Use any assistive technology.</strong> Screen readers, switch access, eye tracking, AAC devices, and
              other tools are always welcome. Nothing in these terms restricts them.
            </li>
            <li>
              <strong>Communicate at your own pace.</strong> No feature penalizes pauses, repetitions, blocks, or slow
              speech. Session analytics are for you, and nobody sees them unless you choose to share them.
            </li>
            <li>
              <strong>Report barriers.</strong> If something is hard or impossible to use, tell the OmniVoice team.
              Accessibility problems are treated as high-priority bugs, and you can ask for this information in another
              format.
            </li>
            <li>
              <strong>Your legal rights stay intact.</strong> Nothing in these terms limits rights you have under
              disability, accessibility, or consumer protection laws where you live.
            </li>
          </ul>
        </Section>

        <Section id="terms-use" title="Using OmniVoice OS">
          <p>
            You may use OmniVoice OS for personal communication and in clinical or educational settings. Do not use it to
            impersonate someone, to share another person&apos;s information without their consent, or to break the law.
            Connect a caregiver only when both of you agree to share.
          </p>
          <p>
            Services you choose to configure, such as relay servers and the apps you paste into, have their own terms. See
            the{' '}
            <button type="button" onClick={() => openModal({ kind: 'privacy' })} className={buttonStyles.link}>
              privacy policy
            </button>{' '}
            for how your data moves.
          </p>
        </Section>

        <Section id="terms-liability" title="No warranty">
          <p>
            OmniVoice OS is provided as is, without warranties of any kind. To the extent the law allows, its makers are
            not liable for harm that results from relying on its measurements, reconstructed text, or alerts.
          </p>
        </Section>

        <Section id="terms-changes" title="Changes to these terms">
          <p>
            When these terms change in a way that matters, the date at the top changes and the I understand button comes
            back so you can review and acknowledge the new version.
          </p>
        </Section>
      </div>
    </Modal>
  );
}
