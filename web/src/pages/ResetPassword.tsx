import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../lib/auth';

export default function ResetPassword() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setSubmitting(true);
    try {
      await auth.resetPasswordForEmail(email);
      setMessage('Password reset email sent. Check your inbox for instructions.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset email.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-screen w-full place-items-center bg-white px-4 text-ink">
      <div className="pointer-events-none absolute right-6 top-6 hidden items-center gap-2 lg:flex">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3">All systems operational</span>
      </div>

      <div className="w-full max-w-[380px]">
        <Link
          to="/login"
          className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>

        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-ink">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M6 7l4 6 4-6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="leading-none">
            <div className="text-[16px] font-semibold tracking-[-0.015em] text-ink">PrepShip</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-3">Dr Prepper Fulfillment</div>
          </div>
        </div>

        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Reset your password</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
          Enter your portal email and we'll send reset instructions.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-[12px] font-medium text-ink-2">Email</span>
            <div className="mt-1.5 flex h-9 items-center rounded-md border border-line bg-white px-3 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                autoFocus
                disabled={submitting}
                placeholder="you@drprepperusa.com"
                autoComplete="username"
                className="flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          </label>

          {message ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800" role="status">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700" role="alert">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="mt-0.5 shrink-0">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 6v5M10 14v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-ink text-[13px] font-medium text-white transition-colors hover:bg-ink-2 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
                Sending…
              </>
            ) : (
              'Send reset email'
            )}
          </button>
        </form>

        <div className="mt-8 border-t border-line pt-5 text-center text-[12px] leading-relaxed text-ink-3">
          Reset links expire after 60 minutes. Contact your PrepShip admin if you don't receive an email within 5 minutes.
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex items-center justify-center gap-4 px-6 lg:justify-between lg:px-10">
        <span className="font-mono text-[10px] tracking-[0.16em] text-ink-3">© {new Date().getFullYear()} Dr Prepper USA · Gardena, CA</span>
        <span className="hidden font-mono text-[10px] tracking-[0.16em] text-ink-3 lg:inline">v4.2 · stable</span>
      </div>
    </main>
  );
}
