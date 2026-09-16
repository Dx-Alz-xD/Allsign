'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import type { ProfileMode, SystemState } from '@shared/types';
import { EmergencyAlertDialog } from '@/components/modals/EmergencyAlertDialog';
import { ModalProvider, useModals } from '@/components/modals/ModalProvider';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { Navbar } from '@/components/ui/Navbar';
import { Sidebar } from '@/components/ui/Sidebar';
import { AccessibilityView } from '@/components/views/AccessibilityView';
import { AnalyticsView } from '@/components/views/AnalyticsView';
import { HomeView } from '@/components/views/HomeView';
import { SettingsView } from '@/components/views/SettingsView';
import { TriggersView } from '@/components/views/TriggersView';
import { useHotkeyAction } from '@/hooks/useHotkeyAction';
import { NAV_ITEMS, type ViewId } from '@/lib/navigation';
import { DEFAULT_PROFILE } from '@/lib/profiles';
import { cn } from '@/lib/cn';

const INITIAL_SYSTEM_STATE: SystemState = {
  activeProfile: DEFAULT_PROFILE,
  isDirectPasteActive: false,
  webRtcPeerConnected: false,
  latencyMs: 0,
};

export default function DashboardPage() {
  return (
    <SettingsProvider>
      <ModalProvider>
        <DashboardShell />
      </ModalProvider>
    </SettingsProvider>
  );
}

function DashboardShell() {
  const { openModal, closeModal } = useModals();
  const [view, setView] = useState<ViewId>('home');
  const [systemState, setSystemState] = useState<SystemState>(INITIAL_SYSTEM_STATE);
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const current = NAV_ITEMS.find((item) => item.id === view) ?? NAV_ITEMS[0];
  const isPitchDashboard = view === 'home' && systemState.activeProfile === 'pitch_demo';

  const selectView = useCallback((next: ViewId) => {
    setView(next);
    setNavOpen(false);
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  const changeProfile = useCallback((profile: ProfileMode) => {
    setSystemState((state) => ({ ...state, activeProfile: profile }));
  }, []);

  const [muted, setMuted] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const lastRegularProfileRef = useRef<ProfileMode>(DEFAULT_PROFILE);

  useEffect(() => {
    if (systemState.activeProfile !== 'pitch_demo') lastRegularProfileRef.current = systemState.activeProfile;
  }, [systemState.activeProfile]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    const message = next ? 'Microphone muted' : 'Microphone on';
    setAnnouncement(message);
    // A shortcut pressed in another app gets no visual feedback here, so confirm it with a system notification.
    if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(message, { silent: true });
    }
  }, [muted]);

  const closeEmergency = useCallback(() => setEmergencyOpen(false), []);

  useHotkeyAction((action) => {
    if (action === 'toggle-mute') {
      toggleMute();
    } else if (action === 'emergency-alert') {
      // Settings and policy dialogs sit in the top layer, so close them or the alert would be hidden behind.
      closeModal();
      setEmergencyOpen(true);
    } else {
      const leaving = systemState.activeProfile === 'pitch_demo';
      changeProfile(leaving ? lastRegularProfileRef.current : 'pitch_demo');
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
        profile={systemState.activeProfile}
        onProfileChange={changeProfile}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
        menuButtonRef={menuButtonRef}
        muted={muted}
        onToggleMute={toggleMute}
        onOpenSettings={() => openModal({ kind: 'settings' })}
      />
      <EmergencyAlertDialog open={emergencyOpen} onClose={closeEmergency} />

      <div className="flex">
        <Sidebar active={view} onSelect={selectView} mobileOpen={navOpen} onMobileClose={closeNav} />

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-10">
          <div className={cn('mx-auto', isPitchDashboard ? 'max-w-[112rem]' : 'max-w-5xl')}>
            <header className="mb-8">
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold text-ink focus:outline-none sm:text-4xl">
                {current.label}
              </h1>
              <p className="mt-2 text-lg text-mist">{current.description}</p>
            </header>

            {view === 'home' && <HomeView state={systemState} />}
            {view === 'analytics' && <AnalyticsView />}
            {view === 'triggers' && <TriggersView />}
            {view === 'settings' && <SettingsView />}
            {view === 'accessibility' && <AccessibilityView />}
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}
