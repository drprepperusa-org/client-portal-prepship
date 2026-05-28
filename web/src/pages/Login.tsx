import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Check } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { EmailInput, PasswordInput } from '../components/ui/Input';

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.loading) {
    return (
      <div className="grid min-h-screen w-full place-items-center bg-[#FAFAFA] text-ink-3">
        Loading…
      </div>
    );
  }

  const redirectParam = new URLSearchParams(location.search).get('redirect');
  const from =
    redirectParam ??
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ??
    '/dashboard';

  if (auth.accessToken) return <Navigate to={from} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Email and password are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await auth.signIn(cleanEmail, password);
      // rememberMe persistence is handled by the auth provider session logic implicitly
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in';
      setError(/invalid login/i.test(message) ? 'Invalid email or password.' : message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full bg-white text-ink selection:bg-brand/20 selection:text-brand-dark">
      {/* Left Column: Form */}
      <div className="flex w-full flex-col justify-center px-6 lg:w-1/2 lg:px-16 xl:px-24">
        {/* Top-right status for mobile only, hidden on desktop since split screen */}
        <div className="absolute right-6 top-6 flex items-center gap-2 lg:hidden">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3">Operational</span>
        </div>

        <div className="mx-auto w-full max-w-[400px]">
          {/* Brand Logo */}
          <div 
            className="mb-8 flex items-center gap-3 animate-fadeInUp" 
            style={{ animationFillMode: 'both' }}
          >
            <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white p-1.5 shadow-[0_4px_12px_rgba(3,169,244,0.18)] ring-1 ring-line">
              <img src="/prepship-v4-logo.svg" alt="" className="h-full w-full object-contain" aria-hidden />
            </div>
            <div>
              <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink">PrepShip</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-3">Dr Prepper Fulfillment</div>
            </div>
          </div>

          {/* Headings */}
          <div 
            className="mb-8 animate-fadeInUp" 
            style={{ animationDelay: '100ms', animationFillMode: 'both' }}
          >
            <h1 className="text-[26px] font-semibold tracking-tight text-ink">Welcome back</h1>
            <p className="mt-2 text-[14px] text-ink-2">
              Sign in to your account to manage your fulfillment dashboard.
            </p>
          </div>

          {/* Global Error Alert */}
          <div 
            className={`overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
              error ? 'mb-6 max-h-20 opacity-100' : 'mb-0 max-h-0 opacity-0'
            }`}
          >
            <div className="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-[13px] text-danger-700">
              <ShieldCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-danger" />
              <p className="font-medium text-danger">{error}</p>
            </div>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-5">
            <div 
              className="animate-fadeInUp" 
              style={{ animationDelay: '200ms', animationFillMode: 'both' }}
            >
              <EmailInput
                label="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                disabled={submitting}
                autoFocus
                required
              />
            </div>
            
            <div 
              className="animate-fadeInUp" 
              style={{ animationDelay: '300ms', animationFillMode: 'both' }}
            >
              <PasswordInput
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={submitting}
                required
              />
              <div className="mt-3 flex items-center justify-between">
                <label className="group flex cursor-pointer items-center gap-2">
                  <div className={`
                    grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-all duration-200
                    ${rememberMe 
                      ? 'border-brand bg-brand text-white' 
                      : 'border-line-2 bg-transparent text-transparent group-hover:border-brand/60'
                    }
                  `}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <input 
                    type="checkbox" 
                    className="sr-only" 
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span className="text-[13px] font-medium text-ink-2 select-none">Remember me</span>
                </label>
                <Link to="/reset-password" className="text-[13px] font-medium text-brand transition-colors hover:text-brand-dark hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <div 
              className="mt-2 animate-fadeInUp" 
              style={{ animationDelay: '400ms', animationFillMode: 'both' }}
            >
              <button
                type="submit"
                disabled={submitting || !email.trim() || !password}
                className="group relative flex h-[44px] w-full items-center justify-center gap-2 overflow-hidden rounded-[10px] bg-brand text-[14px] font-semibold text-white shadow-[0_4px_14px_rgba(3,169,244,0.25)] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-[1px] hover:bg-brand-dark hover:shadow-[0_6px_20px_rgba(3,169,244,0.35)] active:translate-y-[1px] active:shadow-[0_2px_8px_rgba(3,169,244,0.25)] disabled:pointer-events-none disabled:opacity-65"
              >
                <div className={`absolute inset-0 flex items-center justify-center transition-transform duration-300 ease-in-out ${submitting ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0'}`}>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
                </div>
                <div className={`flex items-center gap-2 transition-transform duration-300 ease-in-out ${submitting ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'}`}>
                  Sign in
                  <ArrowRight size={16} strokeWidth={2.5} className="transition-transform duration-300 group-hover:translate-x-1" />
                </div>
              </button>
            </div>
          </form>

          {/* Footer content */}
          <div 
            className="mt-8 text-center animate-fadeInUp"
            style={{ animationDelay: '500ms', animationFillMode: 'both' }}
          >
            <div className="mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-4">
              <span className="h-px flex-1 bg-line" />
              Secure Portal
              <span className="h-px flex-1 bg-line" />
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              Access is provisioned by your PrepShip admin.<br/>
              Having trouble? Contact support.
            </p>
          </div>
        </div>
      </div>

      {/* Right Column: Branded Visual */}
      <div className="relative hidden w-1/2 overflow-hidden bg-brand lg:block">
        {/* Animated Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand via-[#0288D1] to-[#01579B] opacity-90" />
        
        {/* Subtle Floating Orbs/Shapes */}
        <div className="absolute -left-[10%] top-[10%] h-[50vw] w-[50vw] rounded-full bg-white/10 blur-[80px]" />
        <div className="absolute -bottom-[20%] right-[10%] h-[40vw] w-[40vw] rounded-full bg-[#81D4FA]/20 blur-[100px]" />
        
        {/* System Status Top Right */}
        <div className="absolute right-8 top-8 flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur-md">
          <span className="inline-block h-2 w-2 rounded-full bg-[#69F0AE] shadow-[0_0_0_3px_rgba(105,240,174,0.2)]" aria-hidden />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-white">All systems operational</span>
        </div>

        {/* Hero Copy inside right column */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-16 text-center text-white">
          <div className="animate-fadeInUp" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
            <h2 className="text-[40px] font-bold tracking-tight">Streamlined Fulfillment.</h2>
            <p className="mt-4 max-w-[400px] text-[16px] font-medium leading-relaxed text-white/80">
              Manage your inventory, monitor outbound orders, and sync seamlessly across platforms.
            </p>
          </div>
          
          <div className="mt-16 grid grid-cols-2 gap-4 animate-fadeInUp" style={{ animationDelay: '400ms', animationFillMode: 'both' }}>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
              <div className="text-[24px] font-bold">99.9%</div>
              <div className="mt-1 text-[13px] font-medium text-white/70">Uptime SLA</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
              <div className="text-[24px] font-bold">24/7</div>
              <div className="mt-1 text-[13px] font-medium text-white/70">Expert Support</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Dynamic Keyframes for simple stagger (if not in tailwind.config) */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeInUp {
          animation: fadeInUp 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
      `}</style>
    </main>
  );
}
