import type { Metadata } from 'next';
import { CaregiverConsole } from '@/components/caregiver/CaregiverConsole';

export const metadata: Metadata = {
  title: 'Caregiver console',
  description: 'Watch a Voicematics speaker who approved you: live voice readings, alerts and sentences, from any browser.',
};

const ROOM_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

export default function CaregiverPage({ searchParams }: { searchParams?: { room?: string } }) {
  const room = (searchParams?.room ?? '').toUpperCase();
  return (
    <main className="mx-auto max-w-6xl px-6 pb-10 pt-28">
      <p className="text-xs font-bold uppercase tracking-wider text-ember">Caregiver console</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-bone sm:text-4xl">Stay with them, from anywhere</h1>
      <p className="mt-3 max-w-2xl text-smoke">
        Watch the voice readings, alerts and sentences of someone who approved you, live in this browser. Nothing to install; the two devices connect directly, and
        nobody gets in with a room code alone.
      </p>
      <div className="mt-8">
        <CaregiverConsole initialRoom={ROOM_PATTERN.test(room) ? room : ''} />
      </div>
    </main>
  );
}
