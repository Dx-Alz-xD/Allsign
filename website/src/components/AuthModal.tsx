'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useSession } from '@/lib/session';

export type AuthMode = 'signin' | 'signup';

interface AuthModalProps {
  mode: AuthMode | null;
  onClose: () => void;
  onDone: () => void;
}

export function AuthModal({ mode, onClose, onDone }: AuthModalProps) {
  const session = useSession();
  const [current, setCurrent] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode) {
      setCurrent(mode);
      setError(null);
      setPassword('');
    }
  }, [mode]);

  if (!mode) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (current === 'signup') await session.signUp({ email, password });
      else await session.signIn({ email, password });
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={current === 'signup' ? 'Create your account' : 'Sign in'} locked={busy}>
      <div className="mb-4 grid grid-cols-2 rounded-lg border border-white/10 p-1 text-sm">
        {(['signin', 'signup'] as const).map((option) => (
          <button key={option} type="button" onClick={() => setCurrent(option)} className={`rounded-md py-1.5 font-semibold transition ${current === option ? 'bg-ember/20 text-bone' : 'text-smoke hover:text-bone'}`}>
            {option === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="auth-email" className="label">
            Email
          </label>
          <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="field" />
        </div>
        <div>
          <label htmlFor="auth-password" className="label">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            required
            minLength={current === 'signup' ? 8 : 1}
            autoComplete={current === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
          />
          {current === 'signup' && <p className="mt-1 text-xs text-smoke">At least 8 characters. A free licence key is created with the account.</p>}
        </div>
        {error && <p className="text-sm text-crimson">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : current === 'signup' ? <UserPlus aria-hidden className="size-4" /> : <LogIn aria-hidden className="size-4" />}
          {current === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </Modal>
  );
}
