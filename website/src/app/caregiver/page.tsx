import type { Metadata } from 'next';
import Link from 'next/link';
import { AudioWaveform } from 'lucide-react';
import { CaregiverConsole } from '@/components/caregiver/CaregiverConsole';

export const metadata: Metadata = {
  title: 'Caregiver console',
  description: 'Watch a Voicematics speaker live from any browser: voice readings, alerts and rebuilt sentences. No install, no account.',
};

const ROOM_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

export default function CaregiverPage({ searchParams }: { searchParams?: { room?: string } }) {
  const room = (searchParams?.room ?? '').toUpperCase();
  return (
    <>
      <header className="border-b border-white/[0.06] bg-obsidian/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold text-bone">
            <AudioWaveform aria-hidden className="size-6 text-ember" />
            Voicematics
          </Link>
          <span className="text-sm text-smoke">Caregiver console</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-3xl font-bold text-bone sm:text-4xl">Stay with them, from anywhere</h1>
        <p className="mt-3 max-w-2xl text-smoke">
          Watch a speaker&apos;s voice readings, get their alerts and read every sentence the app rebuilds, live in this browser. Nothing to install and no
          account needed: the speaker shares a room code from the desktop app and the two devices connect directly.
        </p>
        <div className="mt-8">
          <CaregiverConsole initialRoom={ROOM_PATTERN.test(room) ? room : ''} />
        </div>
      </main>
    </>
  );
}
