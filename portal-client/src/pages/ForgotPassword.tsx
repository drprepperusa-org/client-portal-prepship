import { useState, type FormEvent } from 'react';
import { ArrowLeft, Mail, PackageCheck, Send } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/Button';
import { EmailInput } from '@/components/ui/Inputs';
import { useToast } from '@/components/ui/Toast';

export default function ForgotPassword() {
  const nav = useNavigate();
  const toast = useToast();
  const { isAuthed, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch (error) {
      toast.error('Reset email failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  if (isAuthed) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthCard>
      <button
        type="button"
        onClick={() => nav('/login')}
        className="focus-ring mb-6 inline-flex cursor-pointer items-center gap-1.5 rounded text-sm font-medium text-ink-3 hover:text-brand-600"
      >
        <ArrowLeft size={15} /> Back to sign in
      </button>

      <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Reset your password</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
        Enter your portal email and we’ll send you a secure recovery link.
      </p>

      {sent ? (
        <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-800 ring-1 ring-emerald-200">
          If an account exists for <strong>{email}</strong>, a password recovery email has been sent. Check your inbox and spam folder.
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <EmailInput
            label="Email"
            required
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            icon={<Mail size={16} />}
            placeholder="you@company.com"
          />
          <Button
            type="submit"
            size="lg"
            loading={sending}
            disabled={!email.trim()}
            className="w-full"
            trailingIcon={<Send size={17} />}
          >
            Send recovery email
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-50 via-white to-brand-50/50 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass">
            <PackageCheck size={20} />
          </span>
          <div className="leading-tight">
            <p className="font-display text-base font-bold tracking-tight text-ink">PrepShip Client Portal</p>
            <p className="text-[11px] font-medium text-ink-3">by DR PREPPER USA</p>
          </div>
        </div>
        <div className="rounded-glass bg-white/80 p-6 shadow-glass ring-1 ring-slate-200/70 backdrop-blur">
          {children}
        </div>
      </div>
    </div>
  );
}
