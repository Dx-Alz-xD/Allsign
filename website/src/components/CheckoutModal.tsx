'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { animate, stagger } from 'animejs';
import { Check, Copy, Download, KeyRound, Loader2, Lock } from 'lucide-react';
import type { CheckoutResponse, PricingPlan } from '@shared/types';
import { Modal } from '@/components/Modal';
import { ApiError, api } from '@/lib/api';
import { formatPrice, periodLabel } from '@/lib/plans';
import { useSession } from '@/lib/session';

interface CheckoutModalProps {
  plan: PricingPlan | null;
  onClose: () => void;
  onDownload: (url: string) => void;
}

type Step = 'account' | 'payment' | 'processing' | 'success';

const PROCESSING_MIN_MS = 1800;
const PROCESSING_LINES = ['Processing zero-cloud authorization...', 'Issuing licence key...', 'Binding plan to your account...'];

function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 19);
  const groups = digits.startsWith('34') || digits.startsWith('37') ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const parts: string[] = [];
  let index = 0;
  for (const size of groups) {
    if (index >= digits.length) break;
    parts.push(digits.slice(index, index + size));
    index += size;
  }
  return parts.join(' ');
}

function parseExpiry(raw: string): { month: number; year: number } | null {
  const match = raw.replace(/\s/g, '').match(/^(\d{1,2})\/?(\d{2}|\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return month >= 1 && month <= 12 ? { month, year } : null;
}

export function CheckoutModal({ plan, onClose, onDownload }: CheckoutModalProps) {
  const session = useSession();
  const [step, setStep] = useState<Step>('account');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!plan) return;
    setStep(session.account ? 'payment' : 'account');
    setEmail(session.account?.user.email ?? '');
    setPassword('');
    setError(null);
    setResult(null);
    setCopied(false);
  }, [plan, session.account]);

  useEffect(() => {
    if (step !== 'processing') return;
    const timer = window.setInterval(() => setLine((index) => (index + 1) % PROCESSING_LINES.length), 700);
    return () => window.clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (step === 'success' && successRef.current) {
      animate(successRef.current.querySelectorAll('.success-item'), { opacity: [0, 1], y: [14, 0], duration: 600, delay: stagger(110), ease: 'outCubic' });
    }
  }, [step]);

  if (!plan) return null;

  const submitAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      try {
        await session.signUp({ email, password });
      } catch (signupError) {
        if (signupError instanceof ApiError && signupError.status === 409) await session.signIn({ email, password });
        else throw signupError;
      }
      setStep('payment');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    const parsedExpiry = parseExpiry(expiry);
    if (!parsedExpiry) {
      setError('Enter the expiry as MM/YY.');
      return;
    }
    if (!session.token) {
      setStep('account');
      return;
    }
    setError(null);
    setStep('processing');
    const started = performance.now();
    try {
      const response = await api.billing.checkout(
        { planId: plan.id as 'pro_monthly' | 'pro_annual' | 'lifetime', card: { number: cardNumber, expMonth: parsedExpiry.month, expYear: parsedExpiry.year, cvc, name } },
        session.token,
      );
      const remaining = PROCESSING_MIN_MS - (performance.now() - started);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      session.applyAccount({ user: response.user, license: response.license }, response.subscription);
      setResult(response);
      setStep('success');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setStep('payment');
    }
  };

  const copyKey = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.license.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const locked = step === 'processing';
  const title = step === 'success' ? 'You are all set' : `Subscribe to ${plan.name}`;

  return (
    <Modal open onClose={onClose} title={title} size="lg" locked={locked}>
      {step !== 'success' && (
        <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-smoke">Order summary</p>
            <p className="mt-3 font-display text-lg font-semibold text-bone">Voicematics {plan.name}</p>
            <p className="mt-1 font-display text-3xl font-bold text-bone">
              {formatPrice(plan.priceCents)}
              <span className="text-sm font-normal text-smoke">{periodLabel(plan)}</span>
            </p>
            <ul className="mt-4 space-y-1 text-xs text-smoke">
              {plan.features.slice(0, 4).map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>
            <p className="mt-4 flex items-center gap-1 text-[11px] text-smoke">
              <Lock aria-hidden className="size-3" />
              Demo checkout. Only the card brand and last four digits are stored.
            </p>
          </aside>

          {step === 'account' && (
            <form onSubmit={submitAccount} className="space-y-4">
              <p className="text-sm text-smoke">Sign in or create the account the licence will belong to.</p>
              <div>
                <label htmlFor="co-email" className="label">
                  Email
                </label>
                <input id="co-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="field" />
              </div>
              <div>
                <label htmlFor="co-password" className="label">
                  Password
                </label>
                <input id="co-password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="field" />
                <p className="mt-1 text-xs text-smoke">At least 8 characters. Stored as an Argon2id hash on the local backend.</p>
              </div>
              {error && <p className="text-sm text-crimson">{error}</p>}
              <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
                {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <KeyRound aria-hidden className="size-4" />}
                Continue to payment
              </button>
            </form>
          )}

          {(step === 'payment' || step === 'processing') && (
            <form onSubmit={submitPayment} className="relative space-y-4">
              <div>
                <label htmlFor="co-account" className="label">
                  Account
                </label>
                <input id="co-account" type="email" value={email} readOnly className="field opacity-70" />
              </div>
              <div>
                <label htmlFor="co-card" className="label">
                  Card number
                </label>
                <input
                  id="co-card"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="4242 4242 4242 4242"
                  required
                  value={cardNumber}
                  onChange={(event) => setCardNumber(formatCardNumber(event.target.value))}
                  className="field font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="co-expiry" className="label">
                    Expiry
                  </label>
                  <input id="co-expiry" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" required value={expiry} onChange={(event) => setExpiry(event.target.value)} className="field font-mono" />
                </div>
                <div>
                  <label htmlFor="co-cvc" className="label">
                    CVC
                  </label>
                  <input id="co-cvc" inputMode="numeric" autoComplete="cc-csc" placeholder="123" required pattern="\d{3,4}" value={cvc} onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 4))} className="field font-mono" />
                </div>
              </div>
              <div>
                <label htmlFor="co-name" className="label">
                  Name on card
                </label>
                <input id="co-name" autoComplete="cc-name" required value={name} onChange={(event) => setName(event.target.value)} className="field" />
              </div>
              {error && <p className="text-sm text-crimson">{error}</p>}
              <button type="submit" disabled={locked} className="btn-primary w-full justify-center">
                <Lock aria-hidden className="size-4" />
                Pay {formatPrice(plan.priceCents)}
              </button>
              {locked && (
                <div className="absolute inset-0 -m-2 flex flex-col items-center justify-center gap-3 rounded-xl bg-onyx/90 backdrop-blur-sm" role="status" aria-live="polite">
                  <Loader2 aria-hidden className="size-8 animate-spin text-ember" />
                  <p className="font-display text-sm font-semibold text-bone">{PROCESSING_LINES[line]}</p>
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {step === 'success' && result && (
        <div ref={successRef} className="space-y-5">
          <div className="success-item flex items-center gap-3 opacity-0">
            <span className="grid size-10 place-items-center rounded-full bg-ember/15 ring-1 ring-ember">
              <Check aria-hidden className="size-5 text-ember" />
            </span>
            <p className="text-smoke">
              {plan.name} is active on <span className="text-bone">{result.user.email}</span>.
            </p>
          </div>
          <div className="success-item rounded-xl border border-ember/50 bg-black/40 p-5 opacity-0">
            <p className="text-xs font-bold uppercase tracking-wider text-smoke">Your licence key</p>
            <p className="mt-2 break-all font-mono text-2xl font-bold tracking-widest text-bone sm:text-3xl">{result.license.key}</p>
            <p className="mt-2 text-xs text-smoke">Enter it with your email when the desktop app starts. It binds to the first machine that activates it.</p>
            <button type="button" onClick={() => void copyKey()} className="btn-secondary mt-4">
              {copied ? <Check aria-hidden className="size-4 text-ember" /> : <Copy aria-hidden className="size-4" />}
              {copied ? 'Copied' : 'Copy License Key'}
            </button>
          </div>
          <div className="success-item flex flex-wrap gap-3 opacity-0">
            <button type="button" onClick={() => onDownload(result.downloadUrl)} className="btn-primary">
              <Download aria-hidden className="size-4" />
              Download Voicematics-Setup.exe
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
