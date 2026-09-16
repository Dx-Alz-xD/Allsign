'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { AudioWaveform, Eye, EyeOff, LoaderCircle, RefreshCw } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import { inputStyles } from '@/components/modals/settings/controls';
import { useAccount } from '@/components/providers/AccountProvider';
import { ApiError, backendUrl } from '@/lib/api/client';
import { cn } from '@/lib/cn';

type Mode = 'login' | 'signup';

const MIN_PASSWORD = 8;

function describeError(error: unknown, mode: Mode): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'An account with this email already exists. Sign in instead.';
    if (error.status === 422) return 'Check the email address and password.';
    if (error.status === 429) return error.message;
    if (error.status >= 500) return 'The Voicematics server had a problem. Try again in a moment.';
    return error.message;
  }
  return mode === 'signup'
    ? `Voicematics could not reach its server at ${backendUrl()} to create your account.`
    : `Voicematics could not reach its server at ${backendUrl()}.`;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-10 place-items-center rounded-lg bg-neon-edge shadow-neon-soft">
        <AudioWaveform aria-hidden className="size-6 text-void" strokeWidth={2.5} />
      </span>
      <span className="font-display text-2xl font-bold tracking-tight text-ink">Voicematics</span>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

export function AccountLoading() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-4 text-center" role="status">
        <Brand />
        <p className="flex items-center gap-2 text-mist">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          Opening your account
        </p>
      </div>
    </Frame>
  );
}

export function SignInScreen() {
  const { signIn, notice, canRetry, retry } = useAccount();
  const { openModal } = useModals();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { email: useId(), password: useId(), hint: useId(), error: useId() };

  const tooShort = mode === 'signup' && password.length > 0 && password.length < MIN_PASSWORD;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn({ email: email.trim(), password }, mode);
    } catch (caught) {
      setError(describeError(caught, mode));
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <Frame>
      <Brand />
      <h1 className="mt-8 text-3xl font-bold text-ink">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
      <p className="mt-2 leading-relaxed text-mist">
        {mode === 'login'
          ? 'Your triggers, presets and session history come with you to any computer you sign in on.'
          : 'Start on the Free plan: ClearVoice, Aphasia Mode, the Sensory HUD and one acoustic trigger. Upgrade any time on the website.'}
      </p>

      {notice && (
        <div role="status" className="mt-5 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-ink">
          <p>{notice}</p>
          {canRetry && (
            <button type="button" onClick={() => void retry()} className={cn(buttonStyles.secondary, 'mt-3 h-9 px-3 text-sm')}>
              <RefreshCw aria-hidden className="size-4" />
              Try again
            </button>
          )}
        </div>
      )}

      <div role="group" aria-label="Account" className="mt-6 grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1">
        {(['login', 'signup'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => switchMode(option)}
            className={cn(
              'h-10 rounded-lg font-display font-semibold transition-colors',
              mode === option ? 'bg-white/10 text-ink' : 'text-mist hover:text-ink',
            )}
          >
            {option === 'login' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4" aria-describedby={error ? ids.error : undefined}>
        <div>
          <label htmlFor={ids.email} className="text-sm font-bold text-mist">
            Email
          </label>
          <input
            id={ids.email}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={cn(inputStyles, 'mt-1 h-11')}
          />
        </div>
        <div>
          <label htmlFor={ids.password} className="text-sm font-bold text-mist">
            Password
          </label>
          <div className="relative mt-1">
            <input
              id={ids.password}
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={tooShort}
              aria-describedby={mode === 'signup' ? ids.hint : undefined}
              className={cn(inputStyles, 'h-11 pr-12')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-mist hover:text-ink"
            >
              {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </div>
          {mode === 'signup' && (
            <p id={ids.hint} className={cn('mt-1 text-sm', tooShort ? 'text-warn' : 'text-mist')}>
              At least {MIN_PASSWORD} characters.
            </p>
          )}
        </div>

        {error && (
          <p id={ids.error} role="alert" className="text-warn">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !email.trim() || !password} className={cn(buttonStyles.primary, 'h-11')}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
          {mode === 'login' ? (busy ? 'Signing in' : 'Sign in') : busy ? 'Creating account' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm leading-relaxed text-mist">
        This computer stays signed in until you sign out. By continuing you agree to the{' '}
        <button type="button" onClick={() => openModal({ kind: 'terms' })} className={buttonStyles.link}>
          Terms
        </button>{' '}
        and the{' '}
        <button type="button" onClick={() => openModal({ kind: 'privacy' })} className={buttonStyles.link}>
          Privacy Policy
        </button>
        .
      </p>
    </Frame>
  );
}
