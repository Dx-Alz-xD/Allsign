import type { Metadata } from 'next';
import Link from 'next/link';
import { Accessibility, BadgeAlert, FileCheck2, Stethoscope } from 'lucide-react';
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The rules for using Voicematics and the rights you keep, in plain language.',
};

const UPDATED = '17 September 2026';

const SECTIONS: LegalSection[] = [
  {
    id: 'medical',
    title: 'Not a medical device',
    body: (
      <>
        <p>Voicematics is not a medical device and has not been cleared or approved by the FDA, CE marked, or reviewed by any other medical regulator.</p>
        <p>
          Measurements such as pitch, jitter, shimmer, harmonics-to-noise ratio, vocal strain, fluency and speaking rate are approximate indicators for your own
          awareness. They are not clinical assessments. Do not use them to diagnose a condition, make treatment decisions, or replace care from a speech-language
          pathologist, doctor or other licensed professional.
        </p>
        <p>
          Therapy and fluency features are practice aids that can support professional care, not replace it. <strong>Stop using a voice feedback feature</strong> if you
          feel dizzy, short of breath, uncomfortable or anxious, and talk to your clinician before continuing.
        </p>
      </>
    ),
  },
  {
    id: 'emergency',
    title: 'Emergency alerts',
    body: (
      <>
        <p className="rounded-xl border border-crimson/50 bg-crimson/10 p-4 text-bone">
          <strong>The emergency alert does not call emergency services.</strong> In an emergency, call your local emergency number, such as 911, 112 or 999.
        </p>
        <p>
          The alert in the desktop app, a gesture, or the alert button on your phone notifies caregivers you have approved. Delivery depends on your network, the
          Voicematics server, any relay server and the caregiver&apos;s device, so an alert can be delayed or fail. Do not rely on Voicematics as your only way to get
          help.
        </p>
      </>
    ),
  },
  {
    id: 'text',
    title: 'Recognised text, second answers and direct paste',
    body: (
      <>
        <p>
          Speech recognition runs on your computer and aims to write down exactly what you said, stutters included, but it can mishear. The grammar rules that tidy a
          sentence follow fixed patterns and can change what you meant, and the second answer in ClearVoice is written by an AI model that can guess wrong.
        </p>
        <p>Review text before you send it, especially for medical, legal or financial matters. You are responsible for the messages you send.</p>
        <p>Direct paste types into whichever app has keyboard focus, even while Voicematics is minimised. Check that the right window is in front, and switch it off before saying something you do not want typed.</p>
      </>
    ),
  },
  {
    id: 'caregivers',
    title: 'Caregivers and approval',
    body: (
      <>
        <p>
          Connect a caregiver only when both of you agree to share. A caregiver must sign in, and you must approve their username before any reading, sentence or alert
          reaches them. You can remove a caregiver at any time, and their access ends at once.
        </p>
        <p>Do not ask to watch someone who has not agreed to it, and do not share a room code or your account to get around approval.</p>
      </>
    ),
  },
  {
    id: 'accessibility',
    title: 'Your accessibility rights',
    body: (
      <ul className="list-disc space-y-3 pl-5">
        <li>
          <strong>Accessible by design.</strong> Voicematics aims to meet WCAG 2.1 Level AA. Controls work with a keyboard and are labelled for screen readers, and live
          visuals have text equivalents.
        </li>
        <li>
          <strong>Adjust it to your needs.</strong> High contrast, text up to 200%, your own global shortcuts, and animations that follow your reduce-motion setting.
        </li>
        <li>
          <strong>Use any assistive technology.</strong> Screen readers, switch access, eye tracking, AAC devices and other tools are always welcome. Nothing in these
          terms restricts them.
        </li>
        <li>
          <strong>Communicate at your own pace.</strong> No feature penalises pauses, repetitions, blocks or slow speech. Your analytics are yours, and nobody sees them
          unless you share them.
        </li>
        <li>
          <strong>Report barriers.</strong> Accessibility problems are treated as high-priority bugs, and you can ask for any of this information in another format.
        </li>
        <li>
          <strong>Your legal rights stay intact.</strong> Nothing here limits rights you have under disability, accessibility or consumer protection laws where you live.
        </li>
      </ul>
    ),
  },
  {
    id: 'use',
    title: 'Using Voicematics',
    body: (
      <>
        <p>
          You may use Voicematics for personal communication and in clinical or educational settings. Do not use it to impersonate someone, to share another person&apos;s
          information without their consent, to harass anyone, or to break the law.
        </p>
        <p>
          Services you choose to use alongside it, such as relay servers and the apps you paste into, have their own terms. The{' '}
          <Link href="/privacy" className="text-ember hover:underline">
            Privacy Policy
          </Link>{' '}
          explains how your data moves.
        </p>
      </>
    ),
  },
  {
    id: 'account',
    title: 'Your account, profile and plan',
    body: (
      <>
        <p>
          Voicematics runs with an account. Keep your password to yourself; you are responsible for what happens in your account. Choose a username that does not
          impersonate someone else. You can sign out, or delete your account and everything saved with it, at any time from your profile.
        </p>
        <p>
          <strong>Free</strong> includes ClearVoice, the Sensory HUD, Studio and one gesture. <strong>Pro</strong> and <strong>Lifetime</strong> add the Fluency Coach,
          Therapy, unlimited gestures, the caregiver link with phone alerts, and session analytics. Plans are bought and managed on this website.
        </p>
        <p>
          A paid licence works on one computer at a time; move it from your account. When a monthly or annual plan is cancelled or not renewed, Pro features stay until
          the end of the period you paid for, then the account returns to Free. Your saved data stays: gestures beyond the Free limit are paused until you upgrade again.
        </p>
        <p className="rounded-xl border border-white/10 bg-onyx p-4 text-smoke">
          Checkout on this website is currently a demonstration: no payment processor is connected and no money is taken.
        </p>
      </>
    ),
  },
  {
    id: 'warranty',
    title: 'No warranty',
    body: (
      <p>
        Voicematics is provided as is, without warranties of any kind. To the extent the law allows, its makers are not liable for harm that results from relying on its
        measurements, recognised or rebuilt text, or alerts.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: <p>When these terms change in a way that matters, the date at the top changes, and the desktop app asks you to review and acknowledge the new version.</p>,
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      intro={<p>The rules for using Voicematics and the rights you keep. The summary comes first; the full terms follow.</p>}
      updated={UPDATED}
      related={{ href: '/privacy', label: 'Read the Privacy Policy' }}
      highlights={[
        { icon: Stethoscope, title: 'Not a medical device', text: 'It does not diagnose, treat or monitor any health condition.' },
        { icon: BadgeAlert, title: 'Not an emergency service', text: 'Alerts reach your caregivers, never emergency services.' },
        { icon: FileCheck2, title: 'Check your text', text: 'Recognition, grammar rules and the AI answer can all get words wrong.' },
        { icon: Accessibility, title: 'Your way', text: 'Use it at your own pace, with any assistive technology.' },
      ]}
      sections={SECTIONS}
    />
  );
}
