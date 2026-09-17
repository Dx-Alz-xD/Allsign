'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, LogIn, Sparkles } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useSession } from '@/lib/session';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  /** New visitors answer the interview before their account is created. */
  onCreateAccount: () => void;
}

export function AuthModal({ open, onClose, onCreateAccount }: AuthModalProps) {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setPassword('');
    }
  }, [open]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.signIn({ email, password });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Sign in" locked={busy}>
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
          <input id="auth-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="field" />
        </div>
        {error && (
          <p role="alert" className="text-sm text-crimson">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <LogIn aria-hidden className="size-4" />}
          Sign in
        </button>
      </form>
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm text-bone">New to Voicematics?</p>
        <p className="mt-1 text-sm text-smoke">A few quick questions first, so we can suggest where to start. Then your account.</p>
        <button type="button" onClick={onCreateAccount} disabled={busy} className="btn-secondary mt-3 w-full justify-center">
          <Sparkles aria-hidden className="size-4 text-ember" />
          Create an account
        </button>
      </div>
    </Modal>
  );
}
