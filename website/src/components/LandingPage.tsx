'use client';

import { useState } from 'react';
import type { PricingPlan } from '@shared/types';
import { AgentAssistant } from '@/components/AgentAssistant';
import { AuthModal, type AuthMode } from '@/components/AuthModal';
import { CheckoutModal } from '@/components/CheckoutModal';
import { DashboardOverlay } from '@/components/DashboardOverlay';
import { DownloadSimulation } from '@/components/DownloadSimulation';
import { Features } from '@/components/Features';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { Pipeline } from '@/components/Pipeline';
import { Pricing } from '@/components/Pricing';
import { Readout } from '@/components/Readout';
import { TechSimulator } from '@/components/simulator/TechSimulator';
import { SessionProvider, useSession } from '@/lib/session';

const INSTALLER_URL = 'https://github.com/Dx-Alz-xD/Voicematics/releases/latest/download/Voicematics-Setup.exe';

function Page() {
  const { account } = useSession();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<PricingPlan | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  return (
    <>
      <Header onSignIn={() => setAuthMode('signin')} onOpenDashboard={() => setDashboardOpen(true)} />
      <main>
        <Hero onDownload={() => setDownloadUrl(INSTALLER_URL)} />
        <Readout />
        <Pipeline />
        <Features />
        <TechSimulator />
        <Pricing onSubscribe={setCheckoutPlan} onCreateAccount={() => setAuthMode('signup')} onOpenDashboard={() => setDashboardOpen(true)} />
      </main>
      <footer className="border-t border-white/[0.06] px-6 py-10 text-center text-xs text-smoke">
        Voicematics analyzes your voice on your computer and never uploads audio. Your account, plan and the data you save live on the Voicematics server.
      </footer>

      <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onDone={() => setAuthMode(null)} />
      <CheckoutModal plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} onDownload={(url) => setDownloadUrl(url)} />
      <DashboardOverlay
        open={dashboardOpen && account !== null}
        onClose={() => setDashboardOpen(false)}
        onDownload={() => setDownloadUrl(INSTALLER_URL)}
        onUpgrade={() => {
          setDashboardOpen(false);
          document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
        }}
      />
      <DownloadSimulation url={downloadUrl} onClose={() => setDownloadUrl(null)} />
      <AgentAssistant />
    </>
  );
}

export function LandingPage() {
  return (
    <SessionProvider>
      <Page />
    </SessionProvider>
  );
}
