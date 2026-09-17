import type { Metadata } from 'next';
import { HelpCenter } from '@/components/help/HelpCenter';
import { HELP_ANSWER_COUNT, HELP_TOPICS } from '@/lib/help/guide';

export const metadata: Metadata = {
  title: 'Help',
  description: 'Answers to common questions about Voicematics: setup, ClearVoice, recognition, caregivers and approval, plans, privacy and troubleshooting.',
};

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 pb-10 pt-28">
      <p className="text-xs font-bold uppercase tracking-wider text-ember">Help</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-bone sm:text-5xl">How can we help?</h1>
      <p className="mt-3 max-w-2xl text-lg text-smoke">
        {HELP_ANSWER_COUNT} answers across {HELP_TOPICS.length} topics, from installing the app to approving a caregiver.
      </p>
      <div className="mt-6">
        <HelpCenter />
      </div>
    </main>
  );
}
