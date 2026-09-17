'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import type { ProfileMode, SystemState } from '@shared/types';
import { AccountLoading, SignInScreen } from '@/components/account/SignInScreen';
import { EmergencyAlertDialog, type EmergencyDelivery } from '@/components/modals/EmergencyAlertDialog';
import { ModalProvider, useModals } from '@/components/modals/ModalProvider';
import { AccountProvider, useAccount } from '@/components/providers/AccountProvider';
import { SessionProvider, useSession } from '@/components/providers/SessionProvider';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { Navbar } from '@/components/ui/Navbar';
import { Reveal } from '@/components/ui/Reveal';
import { SessionBar } from '@/components/ui/SessionBar';
import { Sidebar } from '@/components/ui/Sidebar';
import { AccessibilityView } from '@/components/views/AccessibilityView';
import { AccountView } from '@/components/views/AccountView';
import { AnalyticsView } from '@/components/views/AnalyticsView';
import { CaregiverView } from '@/components/views/CaregiverView';
import { HomeView } from '@/components/views/HomeView';
import { SettingsView } from '@/components/views/SettingsView';
import { TriggersView } from '@/components/views/TriggersView';
import { useHotkeyAction } from '@/hooks/useHotkeyAction';
import { NAV_ITEMS, type ViewId } from '@/lib/navigation';
import { DEFAULT_PROFILE } from '@/lib/profiles';
import { cn } from '@/lib/cn';

export default function DashboardPage() {
  return (
    <SettingsProvider>
      <ModalProvider>
        <AccountProvider>
          <AccountGate />
        </AccountProvider>
      </ModalProvider>
    </SettingsProvider>
  );
}

/** Voicematics runs as a signed-in account; a different account gets a fresh session (workers, links, state). */
function AccountGate() {
  const { status, account, email } = useAccount();
  if (status === 'loading') return <AccountLoading />;
  if (status === 'signed-out') return <SignInScreen />;
  return <DashboardShell key={account?.user.id ?? email ?? 'account'} />;
}

function DashboardShell() {
  const [profile, setProfile] = useState<ProfileMode>(DEFAULT_PROFILE);
  const [muted, setMuted] = useState(false);

  return (
    <SessionProvider profile={profile} muted={muted}>
      <ShellContent profile={profile} onProfileChange={setProfile} muted={muted} onMutedChange={setMuted} />
    </SessionProvider>
  );
}

interface ShellContentProps {
  profile: ProfileMode;
  onProfileChange: (profile: ProfileMode) => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}

function ShellContent({ profile, onProfileChange, muted, onMutedChange }: ShellContentProps) {
  const { openModal, closeModal } = useModals();
  const session = useSession();
  const [view, setView] = useState<ViewId>('home');
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const current = NAV_ITEMS.find((item) => item.id === view) ?? NAV_ITEMS[0];
  const wide = view === 'home' && profile === 'pitch_demo';

  const systemState: SystemState = {
    activeProfile: profile,
    isDirectPasteActive: session.directPasteActive,
    webRtcPeerConnected: session.peer.status === 'connected',
    latencyMs: session.live ? session.pipeline.snapshotRef.current.processingMs : 0,
  };

  const selectView = useCallback((next: ViewId) => {
    setView(next);
    setNavOpen(false);
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyDelivery, setEmergencyDelivery] = useState<EmergencyDelivery>(null);
  const [announcement, setAnnouncement] = useState('');
  const lastRegularProfileRef = useRef<ProfileMode>(DEFAULT_PROFILE);

  useEffect(() => {
    if (profile !== 'pitch_demo') lastRegularProfileRef.current = profile;
  }, [profile]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    onMutedChange(next);
    const message = next ? 'Microphone muted' : 'Microphone on';
    setAnnouncement(message);
    // A shortcut pressed in another app gets no visual feedback here, so confirm it with a system notification.
    if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(message, { silent: true });
    }
  }, [muted, onMutedChange]);

  const closeEmergency = useCallback(() => setEmergencyOpen(false), []);
  const { sendEmergency } = session;

  useHotkeyAction((action) => {
    if (action === 'toggle-mute') {
      toggleMute();
    } else if (action === 'emergency-alert') {
      // Settings and policy dialogs sit in the top layer, so close them or the alert would be hidden behind.
      closeModal();
      setEmergencyDelivery(sendEmergency());
      setEmergencyOpen(true);
    } else {
      const leaving = profile === 'pitch_demo';
      onProfileChange(leaving ? lastRegularProfileRef.current : 'pitch_demo');
      setView('home');
      setAnnouncement(leaving ? 'Pitch Mode off' : 'Pitch Mode on');
    }
  });

  return (
    <MotionConfig reducedMotion="user">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <Navbar
        profile={profile}
        onProfileChange={onProfileChange}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
        menuButtonRef={menuButtonRef}
        muted={muted}
        onToggleMute={toggleMute}
        onOpenSettings={() => openModal({ kind: 'settings' })}
        onOpenAccount={() => selectView('account')}
      />
      <EmergencyAlertDialog open={emergencyOpen} onClose={closeEmergency} delivery={emergencyDelivery} />

      <div className="flex">
        <Sidebar active={view} onSelect={selectView} mobileOpen={navOpen} onMobileClose={closeNav} />

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-10">
          <div className={cn('mx-auto', wide ? 'max-w-[112rem]' : 'max-w-5xl')}>
            <header className="mb-6">
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold text-ink focus:outline-none sm:text-4xl">
                {current.label}
              </h1>
              <p className="mt-2 text-lg text-mist">{current.description}</p>
            </header>

            <SessionBar className="mb-6" />

            <Reveal id={view}>
              {view === 'home' && <HomeView state={systemState} onProfileChange={onProfileChange} onSelectView={selectView} />}
              {view === 'analytics' && <AnalyticsView />}
              {view === 'triggers' && <TriggersView />}
              {view === 'caregiver' && <CaregiverView />}
              {view === 'account' && <AccountView />}
              {view === 'settings' && <SettingsView />}
              {view === 'accessibility' && <AccessibilityView />}
            </Reveal>
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}
