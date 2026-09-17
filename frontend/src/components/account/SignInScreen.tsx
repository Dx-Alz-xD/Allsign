'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { animate, createTimeline, stagger, svg } from 'animejs';
import { Eye, EyeOff, LoaderCircle, RefreshCw, ShieldCheck, Timer, WifiOff } from 'lucide-react';
import { VoiceLine, type VoiceLineHandle } from '@/components/account/VoiceLine';
import { buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import { inputStyles } from '@/components/modals/settings/controls';
import { useAccount } from '@/components/providers/AccountProvider';
import { ApiError, backendUrl } from '@/lib/api/client';
import { reducedMotion, settle, shake } from '@/lib/motion';
import { cn } from '@/lib/cn';

type Mode = 'login' | 'signup';

const MIN_PASSWORD = 8;
// lucide's audio-waveform, drawn stroke by stroke when the screen opens.
const MARK_PATH = 'M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2';

const PROMISES = [
  { icon: Timer, text: 'Every frame of your voice is analysed in under 15 ms.' },
  { icon: ShieldCheck, text: 'Audio never leaves this computer. Only your account and settings sync.' },
  { icon: WifiOff, text: 'Keeps working for a week without a connection.' },
];

function describeError(error: unknown, mode: Mode): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'An account with this email already exists. Sign in instead.';
    if (error.status === 422) return 'Check the email address and password.';
    if (error.status === 429) return error.message;
    if (error.status >= 500) return 'The Voicematics server had a problem. Try again in a moment.';
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'The server took too long to answer. It may still be waking up; try again in a moment.';
  }
  return mode === 'signup'
    ? `Voicematics could not reach its server at ${backendUrl()} to create your account.`
    : `Voicematics could not reach its server at ${backendUrl()}.`;
}

function Mark({ className, animated = true }: { className?: string; animated?: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    const path = pathRef.current;
    if (!path || !animated || reducedMotion()) return;
    const [drawable] = svg.createDrawable(path);
    const run = animate(drawable, { draw: ['0 0', '0 1'], duration: 1100, ease: 'inOutSine' });
    return () => {
      run.revert();
    };
  }, [animated]);
  return (
    <span className={cn('grid place-items-center rounded-2xl bg-neon-edge shadow-neon', className)}>
      <svg viewBox="0 0 24 24" aria-hidden className="size-[60%]" fill="none" stroke="rgb(11 15 23)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path ref={pathRef} d={MARK_PATH} />
      </svg>
    </span>
  );
}

export function AccountLoading() {
  const { waking } = useAccount();
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center" role="status">
        <Mark className="size-14" animated={false} />
        <VoiceLine boot={false} className="h-16 max-w-xs" />
        <p className="flex items-center gap-2 text-mist">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {waking ? 'Waking up the server' : 'Opening your account'}
        </p>
      </div>
    </main>
  );
}

interface FieldProps {
  id: string;
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}

function Field({ id, label, children, hint }: FieldProps) {
  return (
    <div className="signin-field opacity-0">
      <label htmlFor={id} className="text-sm font-bold text-mist">
        {label}
      </label>
      <div className="relative mt-1.5">{children}</div>
      {hint}
    </div>
  );
}

/**
 * The first screen of the app. Left: what Voicematics promises, with a live signal trace that ripples
 * for every keystroke. Right: sign in or create an account. One entrance sequence runs when it opens.
 */
export function SignInScreen() {
  const { signIn, notice, canRetry, retry, waking } = useAccount();
  const { openModal } = useModals();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { email: useId(), password: useId(), hint: useId(), error: useId() };
  const root = useRef<HTMLElement>(null);
  const line = useRef<VoiceLineHandle>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const toggleRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ login: null, signup: null });
  const mounted = useRef(false);

  const tooShort = mode === 'signup' && password.length > 0 && password.length < MIN_PASSWORD;

  // The entrance: mark, headline, promises, then the card and its fields.
  useEffect(() => {
    const section = root.current;
    if (!section) return;
    const parts = section.querySelectorAll<HTMLElement>('.signin-rise, .signin-field');
    if (reducedMotion()) {
      settle(parts);
      return;
    }
    const sequence = createTimeline({ defaults: { ease: 'outCubic' } })
      .add(section.querySelectorAll('.signin-rise'), { opacity: [0, 1], y: [16, 0], duration: 700, delay: stagger(90, { start: 200 }) }, 0)
      .add(section.querySelectorAll('.signin-field'), { opacity: [0, 1], y: [12, 0], duration: 520, delay: stagger(70) }, 700);
    return () => {
      sequence.revert();
    };
  }, []);

  // The mode toggle's highlight slides between the two options.
  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const target = toggleRefs.current[mode];
    if (!indicator || !target) return;
    const frame = { x: target.offsetLeft, width: target.offsetWidth };
    if (!mounted.current || reducedMotion()) {
      indicator.style.transform = `translateX(${frame.x}px)`;
      indicator.style.width = `${frame.width}px`;
      mounted.current = true;
      return;
    }
    animate(indicator, { translateX: frame.x, width: frame.width, duration: 380, ease: 'outExpo' });
  }, [mode]);

  useEffect(() => {
    if (error && errorRef.current && cardRef.current) shake(cardRef.current);
  }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    setBusy(true);
    setError(null);
    line.current?.pulse(1.6);
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

  const keyed = (strength: number) => () => line.current?.pulse(strength);

  return (
    <main id="main" ref={root} className="relative isolate min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -left-40 top-1/3 -z-10 size-[36rem] rounded-full bg-neon-cyan/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-24 -z-10 size-[28rem] rounded-full bg-neon-blue/10 blur-3xl" />

      <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,26rem)] lg:gap-16 lg:px-10">
        <section aria-label="About Voicematics" className="min-w-0">
          <div className="signin-rise flex items-center gap-3 opacity-0">
            <Mark className="size-12" />
            <span className="font-display text-2xl font-bold tracking-tight text-ink">Voicematics</span>
          </div>
          <h1 className="signin-rise mt-10 max-w-xl font-display text-4xl font-bold leading-[1.08] text-ink opacity-0 sm:text-5xl lg:text-6xl">
            Your voice, understood on this computer.
          </h1>
          <p className="signin-rise mt-5 max-w-lg text-lg leading-relaxed text-mist opacity-0">
            Voicematics listens here, on this machine, and turns what you say into clear text, feedback and alerts. Type below and watch the
            trace answer.
          </p>
          <div className="signin-rise mt-8 opacity-0">
            <VoiceLine ref={line} className="h-28 sm:h-32" />
          </div>
          <ul className="mt-6 space-y-3">
            {PROMISES.map(({ icon: Icon, text }) => (
              <li key={text} className="signin-rise flex items-start gap-3 text-mist opacity-0">
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-neon-cyan" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="signin-rise rounded-3xl bg-neon-edge p-px shadow-neon opacity-0">
          <div ref={cardRef} className="rounded-[calc(1.5rem-1px)] border border-white/[0.06] bg-void/95 p-6 backdrop-blur-xl sm:p-8">
            <h2 className="text-2xl font-bold text-ink">{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
            <p className="mt-2 leading-relaxed text-mist">
              {mode === 'login'
                ? 'Your triggers, presets and session history come with you to any computer you sign in on.'
                : 'Start on the Free plan: ClearVoice, the Sensory HUD, Studio and one gesture. Upgrade any time on the website.'}
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

            <div role="group" aria-label="Account" className="relative mt-6 grid grid-cols-2 rounded-xl border border-white/10 bg-black/20 p-1">
              <span ref={indicatorRef} aria-hidden className="pointer-events-none absolute inset-y-1 left-0 rounded-lg bg-white/10 ring-1 ring-neon-cyan/40" />
              {(['login', 'signup'] as const).map((option) => (
                <button
                  key={option}
                  ref={(element) => {
                    toggleRefs.current[option] = element;
                  }}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => switchMode(option)}
                  className={cn('relative z-10 h-10 rounded-lg font-display font-semibold transition-colors', mode === option ? 'text-ink' : 'text-mist hover:text-ink')}
                >
                  {option === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4" aria-describedby={error ? ids.error : undefined}>
              <Field id={ids.email} label="Email">
                <input
                  id={ids.email}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={keyed(0.6)}
                  className={cn(inputStyles, 'h-12')}
                />
              </Field>
              <Field
                id={ids.password}
                label="Password"
                hint={
                  mode === 'signup' ? (
                    <p id={ids.hint} className={cn('mt-1.5 text-sm', tooShort ? 'text-warn' : 'text-mist')}>
                      At least {MIN_PASSWORD} characters.
                    </p>
                  ) : undefined
                }
              >
                <input
                  id={ids.password}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={keyed(0.9)}
                  aria-invalid={tooShort}
                  aria-describedby={mode === 'signup' ? ids.hint : undefined}
                  className={cn(inputStyles, 'h-12 pr-12')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-mist hover:text-ink"
                >
                  {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                </button>
              </Field>

              {error && (
                <p ref={errorRef} id={ids.error} role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink">
                  {error}
                </p>
              )}

              <div className="signin-field opacity-0">
                <button type="submit" disabled={busy || !email.trim() || !password} className={cn(buttonStyles.primary, 'relative h-12 w-full overflow-hidden')}>
                  {busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
                  {waking ? 'Waking up the server' : mode === 'login' ? (busy ? 'Signing in' : 'Sign in') : busy ? 'Creating account' : 'Create account'}
                  {busy && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 animate-[scan_1.2s_linear_infinite] bg-void/60 motion-reduce:hidden" />}
                </button>
              </div>
            </form>

            <p className="signin-field mt-6 text-sm leading-relaxed text-mist opacity-0">
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
          </div>
        </div>
      </div>
    </main>
  );
}
