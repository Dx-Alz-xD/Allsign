'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { PrivacyPolicyModal } from '@/components/modals/PrivacyPolicyModal';
import { SettingsModal, type SettingsTab } from '@/components/modals/SettingsModal';
import { TermsOfServiceModal, type TermsSection } from '@/components/modals/TermsOfServiceModal';

export type ModalRequest =
  | { kind: 'settings'; tab?: SettingsTab }
  | { kind: 'privacy' }
  | { kind: 'terms'; section?: TermsSection };

interface ModalContextValue {
  openModal: (request: ModalRequest) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

/** Hosts the app-wide modals. Only one is open at a time; opening another replaces it. */
export function ModalProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ModalRequest | null>(null);
  const closeModal = useCallback(() => setActive(null), []);
  const value = useMemo<ModalContextValue>(() => ({ openModal: setActive, closeModal }), [closeModal]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      <SettingsModal
        open={active?.kind === 'settings'}
        initialTab={active?.kind === 'settings' ? active.tab : undefined}
        onClose={closeModal}
      />
      <PrivacyPolicyModal open={active?.kind === 'privacy'} onClose={closeModal} />
      <TermsOfServiceModal
        open={active?.kind === 'terms'}
        section={active?.kind === 'terms' ? active.section : undefined}
        onClose={closeModal}
      />
    </ModalContext.Provider>
  );
}

export function useModals(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) throw new Error('useModals must be used inside ModalProvider.');
  return context;
}
