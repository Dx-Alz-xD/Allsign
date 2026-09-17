import type { Metadata } from 'next';
import { AccountArea } from '@/components/account/AccountArea';

export const metadata: Metadata = {
  title: 'Your profile',
  description: 'Your Voicematics profile: username, plan, licence key, caregivers and your answers.',
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-10 pt-24 sm:px-6 sm:pt-28">
      <AccountArea />
    </main>
  );
}
