'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PricingPlan } from '@shared/types';
import { CheckoutModal } from '@/components/CheckoutModal';
import { DownloadSimulation } from '@/components/DownloadSimulation';
import { Features } from '@/components/Features';
import { ForCaregivers } from '@/components/ForCaregivers';
import { Hero } from '@/components/Hero';
import { Pipeline } from '@/components/Pipeline';
import { Pricing } from '@/components/Pricing';
import { Readout } from '@/components/Readout';
import { TechSimulator } from '@/components/simulator/TechSimulator';
import { useAuthFlow } from '@/components/site/SiteProviders';
import { INSTALLER_URL } from '@/lib/help/guide';

export function LandingPage() {
  const router = useRouter();
  const { openSignUp } = useAuthFlow();
  const [checkoutPlan, setCheckoutPlan] = useState<PricingPlan | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  return (
    <>
      <main>
        <Hero onDownload={() => setDownloadUrl(INSTALLER_URL)} />
        <Readout />
        <Pipeline />
        <Features />
        <TechSimulator />
        <ForCaregivers />
        <Pricing onSubscribe={setCheckoutPlan} onCreateAccount={openSignUp} onOpenDashboard={() => router.push('/account')} />
      </main>
      <CheckoutModal plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} onDownload={(url) => setDownloadUrl(url)} />
      <DownloadSimulation url={downloadUrl} onClose={() => setDownloadUrl(null)} />
    </>
  );
}
