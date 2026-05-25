import { useState } from 'react';
import { useAuth } from '../lib/auth';

export default function ResetPassword() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await auth.resetPasswordForEmail(email);
      setMessage('Password reset email sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset email');
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-page px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-card bg-surface p-6 shadow-lg ring-1 ring-line">
        <h1 className="text-2xl font-black text-ink">Reset password</h1>
        <p className="mt-1 text-sm text-ink-2">Enter your portal email and we will send reset instructions.</p>
        {message ? <div className="mt-4 rounded-card bg-ok-bg px-4 py-3 text-sm font-bold text-ok ring-1 ring-ok-border">{message}</div> : null}
        {error ? <div className="mt-4 rounded-card bg-danger-bg px-4 py-3 text-sm font-bold text-danger ring-1 ring-danger-border">{error}</div> : null}
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          required
          className="mt-5 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          placeholder="you@example.com"
        />
        <button type="submit" className="mt-4 h-11 w-full rounded-lg bg-brand text-sm font-black text-white">
          Send reset email
        </button>
      </form>
    </div>
  );
}
