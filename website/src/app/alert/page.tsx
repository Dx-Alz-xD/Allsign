import type { Metadata } from 'next';
import { PhoneAlertPad } from '@/components/caregiver/PhoneAlertPad';

export const metadata: Metadata = {
  title: 'Alert button',
  description: 'Send an emergency alert or a quick message from your phone to your Voicematics caregiver.',
};

const ROOM_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

export default function AlertPage({ searchParams }: { searchParams?: { room?: string } }) {
  const room = (searchParams?.room ?? '').toUpperCase();
  return (
    <main className="mx-auto max-w-xl px-4 pb-10 pt-24">
      <h1 className="font-display text-2xl font-bold text-bone sm:text-3xl">Reach your caregiver</h1>
      <p className="mt-2 text-smoke">One tap sends an alert to your approved caregiver&apos;s dashboard, even when the desktop app is closed.</p>
      <div className="mt-6">
        <PhoneAlertPad initialRoom={ROOM_PATTERN.test(room) ? room : ''} />
      </div>
    </main>
  );
}
