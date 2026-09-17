'use client';

/**
 * The interview that comes before an account: who it is for, what should get easier, how the person speaks,
 * where they will use it and how familiar assistive tools are. New visitors finish with the account itself;
 * signed-in accounts that never answered it save the answers to their profile.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { animate, stagger } from 'animejs';
import { ArrowLeft, ArrowRight, AtSign, Check, CircleCheck, CircleX, Loader2, Sparkles, UserRound, X } from 'lucide-react';
import type { OnboardingAnswers } from '@shared/types';
import { ApiError, api } from '@/lib/api';
import { reducedMotion } from '@/lib/motion';
import {
  EXPERIENCE_CHOICES,
  GOAL_CHOICES,
  PLACE_CHOICES,
  ROLE_CHOICES,
  SPEECH_CHOICES,
  emptyAnswers,
  labelOf,
  recommend,
  type Choice,
} from '@/lib/onboarding';
import { useSession } from '@/lib/session';

export type InterviewMode = 'signup' | 'profile';

type StepId = 'role' | 'goals' | 'speech' | 'places' | 'experience' | 'account' | 'welcome';

const QUESTION_STEPS: StepId[] = ['role', 'goals', 'speech', 'places', 'experience'];
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$/;

interface Props {
  mode: InterviewMode;
  onClose: () => void;
  onSignIn: () => void;
}

function suggestUsername(email: string): string {
  const local = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) ?? '';
  return local.length >= 3 ? local : '';
}

export function OnboardingInterview({ mode, onClose, onSignIn }: Props) {
  const session = useSession();
  const steps: StepId[] = mode === 'signup' ? [...QUESTION_STEPS, 'account'] : QUESTION_STEPS;
  const [step, setStep] = useState<StepId>('role');
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => session.account?.profile?.onboarding ?? emptyAnswers());
  const [roleChosen, setRoleChosen] = useState(Boolean(session.account?.profile?.onboarding));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const index = steps.indexOf(step);
  const progress = step === 'welcome' ? 1 : (index + 1) / steps.length;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [busy, onClose]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTo({ top: 0 });
    if (reducedMotion()) return;
    const run = animate(body.querySelectorAll('[data-rise]'), { opacity: [0, 1], y: [16, 0], duration: 420, delay: stagger(45), ease: 'outCubic' });
    return () => {
      run.revert();
    };
  }, [step]);

  const toggle = <K extends 'goals' | 'speech' | 'places'>(key: K, value: OnboardingAnswers[K][number]) =>
    setAnswers((current) => {
      const list = current[key] as string[];
      let next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      // "Prefer not to say" and "not sure" stand alone.
      if (key === 'speech') {
        if (value === 'prefer-not-to-say' || value === 'not-sure') next = next.includes(value) ? [value] : next;
        else next = next.filter((item) => item !== 'prefer-not-to-say' && item !== 'not-sure');
      }
      return { ...current, [key]: next };
    });

  const next = () => {
    setError(null);
    if (index < steps.length - 1) setStep(steps[index + 1]);
  };
  const back = () => {
    setError(null);
    if (index > 0) setStep(steps[index - 1]);
  };

  const saveToProfile = async () => {
    setBusy(true);
    setError(null);
    try {
      await session.updateProfile({ onboarding: answers });
      setStep('welcome');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const canContinue = step !== 'role' || roleChosen;

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" aria-hidden onMouseDown={() => !busy && onClose()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-title"
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden border-white/10 bg-obsidian shadow-ember outline-none sm:max-h-[92vh] sm:rounded-3xl sm:border"
      >
        <div className="h-1 w-full bg-white/10" aria-hidden>
          <div className="h-full bg-ember-edge transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
        <header className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4 sm:px-8">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-smoke">
            <Sparkles aria-hidden className="size-4 text-ember" />
            {step === 'welcome' ? 'All set' : mode === 'signup' ? `Getting to know you · ${index + 1} of ${steps.length}` : `Your answers · ${index + 1} of ${steps.length}`}
          </p>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-lg p-1.5 text-smoke hover:bg-white/10 hover:text-bone disabled:opacity-40">
            <X aria-hidden className="size-5" />
          </button>
        </header>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
          {step === 'role' && (
            <Question title="Who are you setting Voicematics up for?" hint="This shapes what we suggest first. You can change every answer later in your profile.">
              <ChoiceGrid
                choices={ROLE_CHOICES}
                isSelected={(value) => roleChosen && answers.role === value}
                onPick={(value) => {
                  setAnswers((current) => ({ ...current, role: value }));
                  setRoleChosen(true);
                }}
                single
              />
            </Question>
          )}
          {step === 'goals' && (
            <Question title="What would you like to get easier?" hint="Pick as many as you like.">
              <ChoiceGrid choices={GOAL_CHOICES} isSelected={(value) => answers.goals.includes(value)} onPick={(value) => toggle('goals', value)} />
            </Question>
          )}
          {step === 'speech' && (
            <Question title="Anything you would like us to know about how you speak?" hint="Optional. It only tunes the tips you see, and it stays in your account.">
              <ChoiceGrid choices={SPEECH_CHOICES} isSelected={(value) => answers.speech.includes(value)} onPick={(value) => toggle('speech', value)} />
            </Question>
          )}
          {step === 'places' && (
            <Question title="Where will you use it most?" hint="Pick any that apply.">
              <ChoiceGrid choices={PLACE_CHOICES} isSelected={(value) => answers.places.includes(value)} onPick={(value) => toggle('places', value)} />
            </Question>
          )}
          {step === 'experience' && (
            <Question title="How familiar are assistive speech tools?" hint="And if there is anything else we should know, tell us below.">
              <ChoiceGrid
                choices={EXPERIENCE_CHOICES}
                isSelected={(value) => answers.experience === value}
                onPick={(value) => setAnswers((current) => ({ ...current, experience: current.experience === value ? null : value }))}
                single
              />
              <div data-rise className="mt-5">
                <label htmlFor="interview-note" className="label">
                  Anything else (optional)
                </label>
                <textarea
                  id="interview-note"
                  rows={3}
                  maxLength={500}
                  value={answers.note}
                  onChange={(event) => setAnswers((current) => ({ ...current, note: event.target.value }))}
                  placeholder="For example: I block most on the first word of a sentence."
                  className="field resize-none"
                />
                <p className="mt-1 text-right text-xs text-smoke">{answers.note.length} / 500</p>
              </div>
            </Question>
          )}
          {step === 'account' && <AccountStep answers={answers} onBack={back} onEdit={(target) => setStep(target)} onDone={() => setStep('welcome')} onSignIn={onSignIn} />}
          {step === 'welcome' && <Welcome answers={answers} mode={mode} onClose={onClose} />}
          {error && (
            <p role="alert" className="mt-4 text-sm text-crimson">
              {error}
            </p>
          )}
        </div>

        {step !== 'account' && step !== 'welcome' && (
          <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-onyx/60 px-5 py-4 sm:px-8">
            <button type="button" onClick={index === 0 ? onClose : back} className="btn-secondary px-4 py-2.5">
              {index === 0 ? (
                'Not now'
              ) : (
                <>
                  <ArrowLeft aria-hidden className="size-4" />
                  Back
                </>
              )}
            </button>
            {mode === 'signup' && index === 0 && (
              <button type="button" onClick={onSignIn} className="hidden text-sm text-smoke underline-offset-4 hover:text-bone hover:underline sm:block">
                I already have an account
              </button>
            )}
            {index < steps.length - 1 ? (
              <button type="button" onClick={next} disabled={!canContinue} className="btn-primary px-5 py-2.5">
                {step === 'speech' && answers.speech.length === 0 ? 'Skip' : 'Continue'}
                <ArrowRight aria-hidden className="size-4" />
              </button>
            ) : (
              <button type="button" onClick={() => void saveToProfile()} disabled={busy} className="btn-primary px-5 py-2.5">
                {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
                Save answers
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

function Question({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div>
      <h2 id="interview-title" data-rise className="font-display text-2xl font-bold text-bone sm:text-3xl">
        {title}
      </h2>
      <p data-rise className="mt-2 text-smoke">
        {hint}
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function ChoiceGrid<T extends string>({ choices, isSelected, onPick, single = false }: { choices: Choice<T>[]; isSelected: (value: T) => boolean; onPick: (value: T) => void; single?: boolean }) {
  return (
    <div role={single ? 'radiogroup' : 'group'} className="grid gap-3 sm:grid-cols-2">
      {choices.map((choice) => {
        const selected = isSelected(choice.value);
        return (
          <button
            key={choice.value}
            data-rise
            type="button"
            role={single ? 'radio' : 'checkbox'}
            aria-checked={selected}
            onClick={() => onPick(choice.value)}
            className={`group relative flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              selected ? 'border-ember bg-ember/10 shadow-ember-soft' : 'border-white/10 bg-white/[0.03] hover:border-ember/50 hover:bg-white/[0.06]'
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 grid size-5 shrink-0 place-items-center border transition ${single ? 'rounded-full' : 'rounded-md'} ${selected ? 'border-ember bg-ember text-obsidian' : 'border-white/30'}`}
            >
              {selected && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              <span className="block font-display font-semibold text-bone">{choice.label}</span>
              <span className="mt-0.5 block text-sm text-smoke">{choice.detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

type UsernameState = { status: 'idle' } | { status: 'checking' } | { status: 'ok' } | { status: 'bad'; reason: string };

function AccountStep({ answers, onBack, onEdit, onDone, onSignIn }: { answers: OnboardingAnswers; onBack: () => void; onEdit: (step: StepId) => void; onDone: () => void; onSignIn: () => void }) {
  const session = useSession();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usernameState, setUsernameState] = useState<UsernameState>({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedUsername, setTouchedUsername] = useState(false);

  // Until the person types a username, one is suggested from the email address.
  useEffect(() => {
    if (!touchedUsername) setUsername(suggestUsername(email));
  }, [email, touchedUsername]);

  useEffect(() => {
    const candidate = username.trim().toLowerCase();
    if (!candidate) {
      setUsernameState({ status: 'idle' });
      return;
    }
    if (!USERNAME_PATTERN.test(candidate)) {
      setUsernameState({ status: 'bad', reason: '3 to 20 letters, digits, dots or underscores, starting and ending with a letter or digit.' });
      return;
    }
    setUsernameState({ status: 'checking' });
    const timer = window.setTimeout(() => {
      api.profile
        .usernameAvailable(candidate)
        .then((result) => setUsernameState(result.available ? { status: 'ok' } : { status: 'bad', reason: result.reason ?? 'That username is not available.' }))
        .catch(() => setUsernameState({ status: 'idle' }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [username]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (usernameState.status === 'bad') return;
    setBusy(true);
    setError(null);
    try {
      await session.signUp({
        email,
        password,
        username: username.trim().toLowerCase() || undefined,
        displayName: displayName.trim() || undefined,
        onboarding: answers,
      });
      onDone();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409 && /username/i.test(failure.message)) {
        setUsernameState({ status: 'bad', reason: failure.message });
      } else {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  const summary = [
    { step: 'role' as StepId, text: labelOf(ROLE_CHOICES, answers.role) },
    { step: 'goals' as StepId, text: answers.goals.map((goal) => labelOf(GOAL_CHOICES, goal)).join(', ') || 'No goals picked' },
    { step: 'places' as StepId, text: answers.places.map((place) => labelOf(PLACE_CHOICES, place)).join(', ') || 'Anywhere' },
  ];

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div>
        <h2 id="interview-title" data-rise className="font-display text-2xl font-bold text-bone sm:text-3xl">
          Last step: your account
        </h2>
        <p data-rise className="mt-2 text-smoke">
          Your username is how a caregiver you trust is approved to watch you. Nobody can see you without your approval.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div data-rise>
            <label htmlFor="signup-name" className="label">
              Name (optional)
            </label>
            <input id="signup-name" value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" className="field" placeholder="Ada" />
          </div>
          <div data-rise>
            <label htmlFor="signup-username" className="label">
              Username
            </label>
            <div className="relative">
              <AtSign aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-smoke" />
              <input
                id="signup-username"
                value={username}
                maxLength={20}
                onChange={(event) => {
                  setTouchedUsername(true);
                  setUsername(event.target.value.toLowerCase());
                }}
                autoComplete="username"
                aria-describedby="signup-username-status"
                className="field pl-9"
                placeholder="ada.lee"
              />
            </div>
            <p id="signup-username-status" className={`mt-1 flex items-center gap-1.5 text-xs ${usernameState.status === 'bad' ? 'text-crimson' : usernameState.status === 'ok' ? 'text-ember' : 'text-smoke'}`} aria-live="polite">
              {usernameState.status === 'checking' && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              {usernameState.status === 'ok' && <CircleCheck aria-hidden className="size-3.5" />}
              {usernameState.status === 'bad' && <CircleX aria-hidden className="size-3.5" />}
              {usernameState.status === 'idle' && 'Leave it empty and we will make one from your email.'}
              {usernameState.status === 'checking' && 'Checking'}
              {usernameState.status === 'ok' && 'Available'}
              {usernameState.status === 'bad' && usernameState.reason}
            </p>
          </div>
          <div data-rise>
            <label htmlFor="signup-email" className="label">
              Email
            </label>
            <input id="signup-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="field" />
          </div>
          <div data-rise>
            <label htmlFor="signup-password" className="label">
              Password
            </label>
            <input id="signup-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="field" />
            <p className="mt-1 text-xs text-smoke">At least 8 characters.</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-crimson">
            {error}
          </p>
        )}
        <div data-rise className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onBack} disabled={busy} className="btn-secondary px-4 py-2.5">
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </button>
          <button type="submit" disabled={busy || usernameState.status === 'bad' || usernameState.status === 'checking'} className="btn-primary px-5 py-2.5">
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <UserRound aria-hidden className="size-4" />}
            Create my account
          </button>
          <button type="button" onClick={onSignIn} className="text-sm text-smoke underline-offset-4 hover:text-bone hover:underline">
            I already have an account
          </button>
        </div>
        <p data-rise className="mt-4 text-xs text-smoke">
          By creating an account you agree to the{' '}
          <Link href="/terms" className="underline underline-offset-2 hover:text-bone">
            Terms
          </Link>{' '}
          and the{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-bone">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
      <aside data-rise className="h-fit rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-smoke">Your answers</p>
        <ul className="mt-3 space-y-3 text-sm">
          {summary.map((item) => (
            <li key={item.step}>
              <p className="text-bone">{item.text}</p>
              <button type="button" onClick={() => onEdit(item.step)} className="text-xs text-ember hover:underline">
                Change
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </form>
  );
}

function Welcome({ answers, mode, onClose }: { answers: OnboardingAnswers; mode: InterviewMode; onClose: () => void }) {
  const { account } = useSession();
  const picks = useMemo(() => recommend(answers), [answers]);
  const name = account?.profile?.displayName || account?.profile?.username;
  return (
    <div>
      <p data-rise className="grid size-14 place-items-center rounded-2xl bg-ember/15 ring-1 ring-ember/50">
        <CircleCheck aria-hidden className="size-7 text-ember" />
      </p>
      <h2 id="interview-title" data-rise className="mt-5 font-display text-3xl font-bold text-bone">
        {mode === 'signup' ? `Welcome${name ? `, ${name}` : ''}.` : 'Thanks, your answers are saved.'}
      </h2>
      {account?.profile && (
        <p data-rise className="mt-2 text-smoke">
          Your username is <span className="font-semibold text-bone">@{account.profile.username}</span>. Share it with a caregiver so you can approve them.
        </p>
      )}
      <h3 data-rise className="mt-8 text-xs font-bold uppercase tracking-wider text-smoke">
        Where we suggest you start
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {picks.map((pick) => (
          <li key={pick.mode} data-rise className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="flex items-center gap-2 font-display font-semibold text-bone">
              {pick.mode}
              {pick.pro && <span className="badge px-2 py-0.5 text-[10px]">Pro</span>}
            </p>
            <p className="mt-1 text-sm text-smoke">{pick.why}</p>
          </li>
        ))}
      </ul>
      <div data-rise className="mt-8 flex flex-wrap gap-3">
        <Link href="/account" onClick={onClose} className="btn-primary">
          <UserRound aria-hidden className="size-4" />
          Go to my profile
        </Link>
        <button type="button" onClick={onClose} className="btn-secondary">
          Keep exploring
        </button>
      </div>
    </div>
  );
}
