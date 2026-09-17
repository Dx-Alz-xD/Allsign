'use client';

/**
 * Everything every page shares: the signed-in session, the sign-in dialog, the interview that comes before an
 * account, and the help guide. Pages open the dialogs through useAuthFlow().
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AuthModal } from '@/components/AuthModal';
import { HelpGuide } from '@/components/HelpGuide';
import { OnboardingInterview, type InterviewMode } from '@/components/site/OnboardingInterview';
import { SessionProvider, useSession } from '@/lib/session';

interface AuthFlow {
  openSignIn: () => void;
  /** The interview, then the account. */
  openSignUp: () => void;
  /** The interview for a signed-in account, saved to its profile. */
  openInterview: () => void;
}

const AuthFlowContext = createContext<AuthFlow | null>(null);

const DISMISSED_KEY = 'voicematics.interview-dismissed';
// Pages where a pop-up would get in the way: the phone alert button and the caregiver console.
const QUIET_PATHS = ['/alert', '/caregiver'];

function dismissedFor(userId: string): boolean {
  try {
    return (window.localStorage.getItem(DISMISSED_KEY) ?? '').split(',').includes(userId);
  } catch {
    return true;
  }
}

function dismiss(userId: string) {
  try {
    const ids = new Set((window.localStorage.getItem(DISMISSED_KEY) ?? '').split(',').filter(Boolean));
    ids.add(userId);
    window.localStorage.setItem(DISMISSED_KEY, Array.from(ids).join(','));
  } catch {
    // Blocked storage: it may be offered again next visit.
  }
}

function Flow({ children }: { children: ReactNode }) {
  const { ready, account } = useSession();
  const pathname = usePathname();
  const [signIn, setSignIn] = useState(false);
  const [interview, setInterview] = useState<InterviewMode | null>(null);
  const quiet = QUIET_PATHS.some((path) => pathname?.startsWith(path));

  // An account that never answered the interview is offered it once per browser, away from the quiet pages.
  useEffect(() => {
    if (!ready || !account || quiet || interview || signIn) return;
    if (account.profile && !account.profile.onboarding && !dismissedFor(account.user.id)) setInterview('profile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, account?.user.id, account?.profile?.onboarding, quiet]);

  const closeInterview = useCallback(() => {
    if (interview === 'profile' && account) dismiss(account.user.id);
    setInterview(null);
  }, [account, interview]);

  const flow = useMemo<AuthFlow>(
    () => ({
      openSignIn: () => {
        setInterview(null);
        setSignIn(true);
      },
      openSignUp: () => {
        setSignIn(false);
        setInterview('signup');
      },
      openInterview: () => setInterview('profile'),
    }),
    [],
  );

  return (
    <AuthFlowContext.Provider value={flow}>
      {children}
      <AuthModal open={signIn} onClose={() => setSignIn(false)} onCreateAccount={flow.openSignUp} />
      {interview && <OnboardingInterview key={interview} mode={interview} onClose={closeInterview} onSignIn={flow.openSignIn} />}
      {!pathname?.startsWith('/alert') && <HelpGuide />}
    </AuthFlowContext.Provider>
  );
}

export function SiteProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Flow>{children}</Flow>
    </SessionProvider>
  );
}

export function useAuthFlow(): AuthFlow {
  const flow = useContext(AuthFlowContext);
  if (!flow) throw new Error('useAuthFlow must be used inside SiteProviders');
  return flow;
}
