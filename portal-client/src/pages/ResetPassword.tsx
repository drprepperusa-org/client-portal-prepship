import { useState, type FormEvent } from 'react';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/Inputs';
import { useToast } from '@/components/ui/Toast';
import { AuthCard } from './ForgotPassword';

function recoveryLinkError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.get('error_code') === 'otp_expired') return 'This recovery link is invalid or has expired.';
  return params.get('error_description');
}

export default function ResetPassword() {
  const nav = useNavigate();
  const toast = useToast();
  const { loading, isAuthed, passwordRecovery, finishPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const linkError = recoveryLinkError();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      toast.error('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match', 'Check the confirmation field.');
      return;
    }
    setSaving(true);
    try {
      await finishPasswordRecovery(password);
      toast.success('Password updated', 'Sign in with your new password.');
      nav('/login', { replace: true });
    } catch (error) {
      toast.error('Password reset failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-white">
        <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  return (
    <AuthCard>
      {isAuthed && passwordRecovery ? (
        <>
          <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Choose a new password</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-3">Use at least 8 characters for your new portal password.</p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <PasswordInput
              label="New password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              icon={<Lock size={16} />}
              placeholder="At least 8 characters"
            />
            <PasswordInput
              label="Confirm password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              icon={<Lock size={16} />}
              placeholder="Repeat password"
            />
            <Button type="submit" size="lg" loading={saving} className="w-full" trailingIcon={<ArrowRight size={17} />}>
              Update password
            </Button>
          </form>
        </>
      ) : (
        <div className="space-y-5">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <Mail size={22} />
          </span>
          <div>
            <h1 className="font-display text-[24px] font-bold tracking-tight text-ink">
              {linkError ? 'Recovery link expired' : 'Recovery link required'}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
              {linkError ?? 'Open the latest password recovery email to choose a new password.'}
            </p>
          </div>
          <Button className="w-full" onClick={() => nav('/forgot-password', { replace: true })}>
            Send a new recovery email
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
