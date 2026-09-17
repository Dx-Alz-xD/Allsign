import type { Metadata } from 'next';
import Link from 'next/link';
import { AudioWaveform } from 'lucide-react';
import { PhoneAlertPad } from '@/components/caregiver/PhoneAlertPad';

export const metadata: Metadata = {
  title: 'Alert button',
  description: 'Send an emergency alert or a quick message from your phone to your Voicematics caregiver.',
};

const ROOM_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

export default function AlertPage({ searchParams }: { searchParams?: { room?: string } }) {
  const room = (searchParams?.room ?? '').toUpperCase();
  return (
    <>
      <header className="border-b border-white/[0.06] bg-obsidian/80">
        <div className="mx-auto flex h-16 max-w-xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold text-bone">
            <AudioWaveform aria-hidden className="size-6 text-ember" />
            Voicematics
          </Link>
          <span className="text-sm text-smoke">Alert button</span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">
        <h1 className="font-display text-2xl font-bold text-bone sm:text-3xl">Reach your caregiver</h1>
        <p className="mt-2 text-smoke">One tap sends an alert to your caregiver&apos;s dashboard, even when the desktop app is closed.</p>
        <div className="mt-6">
          <PhoneAlertPad initialRoom={ROOM_PATTERN.test(room) ? room : ''} />
        </div>
      </main>
    </>
  );
}
