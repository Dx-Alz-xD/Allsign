import type { Metadata } from 'next';
import Link from 'next/link';
import { Cpu, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Voicematics handles, where it is stored, when it leaves your computer and the choices you have.',
};

const UPDATED = '17 September 2026';

const SECTIONS: LegalSection[] = [
  {
    id: 'what',
    title: 'What Voicematics handles',
    body: (
      <ul className="list-disc space-y-3 pl-5">
        <li>
          <strong>Your account.</strong> Your email address, a salted Argon2id hash of your password (never the password itself), your plan, your licence key, the
          computer it is bound to (as a one-way hash), and the computers you stay signed in on. Checkout keeps only the card brand and last four digits.
        </li>
        <li>
          <strong>Your profile.</strong> Your username, an optional display name, and your answers to the sign-up interview (who you set it up for, your goals, how you
          speak if you chose to say, where you use it, and an optional note). The answers only shape suggestions; you can change or clear them at any time.
        </li>
        <li>
          <strong>Caregiver approvals.</strong> Which accounts asked to watch you, which you approved or denied, and when.
        </li>
        <li>
          <strong>Microphone audio.</strong> Processed in memory on your computer. Speech recognition runs on your computer too. Raw audio is never recorded to a server or
          uploaded.
        </li>
        <li>
          <strong>Voice measurements</strong> such as pitch, jitter, shimmer and vocal strain, shown live. With session analytics, session summaries (speaking rate,
          block counts, fluency) are saved to your account.
        </li>
        <li>
          <strong>Recognised words and rebuilt sentences.</strong> Sent to the Voicematics server to be rebuilt by grammar rules and not saved there. The word-for-word
          transcript is kept on your computer only.
        </li>
        <li>
          <strong>Gestures, presets and therapy targets.</strong> Saved to your account. A gesture is a fingerprint of 128 numbers, which cannot be played back as audio.
        </li>
      </ul>
    ),
  },
  {
    id: 'where',
    title: 'Where your data is stored',
    body: (
      <>
        <p>
          <strong>On the Voicematics server:</strong> your account, profile, plan and licence, caregiver approvals, and the gestures, presets, session summaries and
          therapy targets you save. Other people see only your username and display name, and only when you ask to watch them or they ask to watch you.
        </p>
        <p>
          <strong>On your computer:</strong> settings, the word-for-word transcript, relay credentials, custom shortcuts, and a sign-in token that works only on that
          computer. Your password is never stored there.
        </p>
        <p>
          <strong>In this browser:</strong> a sign-in token for the website and a few preferences, in local storage. Signing out removes the token.
        </p>
      </>
    ),
  },
  {
    id: 'leaves',
    title: 'When data leaves your computer',
    body: (
      <ul className="list-disc space-y-3 pl-5">
        <li>While you are signed in, the app checks your plan with the Voicematics server every few minutes and saves the data listed above to your account.</li>
        <li>Recognised words go to the Voicematics server to be rebuilt into sentences.</li>
        <li>
          With the second answer in ClearVoice switched on, each sentence&apos;s words and your last few sentences go through the Voicematics server to Google Gemini, or
          Groq if Gemini fails, whose own privacy terms apply to that request. Audio never does. Switch it off to keep text away from any AI model.
        </li>
        <li>
          You connect a caregiver you approved. Readings, alerts and sentences travel encrypted directly between the two devices, through a relay only if a direct
          connection fails. The Voicematics server sets up the connection and sees the room code, both accounts and IP addresses, never the shared data.
        </li>
        <li>
          You send an alert from your phone. The server passes it to your approved caregiver and your desktop app, holds it for up to 10 minutes if no caregiver is
          connected, and does not keep it afterwards.
        </li>
        <li>You use direct paste. The text becomes part of the app you paste into, and that app&apos;s privacy policy applies to it.</li>
      </ul>
    ),
  },
  {
    id: 'ai',
    title: 'Artificial intelligence',
    body: (
      <>
        <p>
          Two models are involved, and only two. Speech recognition (Whisper) runs on your computer and never sends audio anywhere. The optional second answer in
          ClearVoice is written by Google Gemini (or Groq as a backup) from the words of a sentence; the server checks that it adds no words you did not say.
        </p>
        <p>The help guide on this website is a fixed set of questions and answers. No model reads what you type into it, and nothing you type is sent anywhere.</p>
      </>
    ),
  },
  {
    id: 'health',
    title: 'Health information, HIPAA and GDPR',
    body: (
      <>
        <p>Voice measurements and interview answers can reveal health information, so Voicematics treats all of your data as sensitive.</p>
        <p>
          <strong>HIPAA.</strong> Voicematics stores account data on its server and is not offered as a HIPAA-covered service. A clinic using it with patients remains
          responsible for its own HIPAA obligations, including whether session data may be saved to accounts and whether second answers may be written by a third-party
          AI provider.
        </p>
        <p>
          <strong>GDPR.</strong> Voicematics collects only what the features you use need, keeps it with your account, and supports your rights to access, export,
          correct and erase it: change your profile and answers any time, download your data in the desktop app, and delete your account from{' '}
          <Link href="/account" className="text-ember hover:underline">
            your profile
          </Link>
          .
        </p>
        <p className="text-smoke">This is a description of how Voicematics works, not a certification or legal advice.</p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'How it is protected',
    body: (
      <ul className="list-disc space-y-3 pl-5">
        <li>Passwords are hashed with Argon2id; sign-in attempts are throttled.</li>
        <li>Every database query uses bound parameters, and every text field is validated for length and shape before it is stored.</li>
        <li>Session tokens travel in headers or WebSocket subprotocols, never in URLs, so they stay out of logs.</li>
        <li>A caregiver cannot see anything with a room code alone: the speaker must approve their account first.</li>
      </ul>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        When this policy changes, the date at the top changes too. See also the{' '}
        <Link href="/terms" className="text-ember hover:underline">
          Terms of Service
        </Link>
        .
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro={<p>What Voicematics handles, where it lives, when it leaves your computer, and what you can do about it.</p>}
      updated={UPDATED}
      related={{ href: '/terms', label: 'Read the Terms of Service' }}
      highlights={[
        { icon: Cpu, title: 'Audio stays on your computer', text: 'Recognition and analysis run locally. No audio is uploaded, ever.' },
        { icon: ShieldCheck, title: 'You approve who watches', text: 'Caregivers need your approval before they see anything.' },
        { icon: Sparkles, title: 'AI only where you see it', text: 'The optional second answer, and nothing else, uses a cloud model.' },
        { icon: EyeOff, title: 'No tracking', text: 'No advertising IDs, no usage analytics, no selling data.' },
      ]}
      sections={SECTIONS}
    />
  );
}
