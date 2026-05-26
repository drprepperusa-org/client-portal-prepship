import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Eye, EyeOff, Lock, Mail, ShieldCheck, Truck } from 'lucide-react';
import { CobeGlobe } from '../components/CobeGlobe';
import { useAuth } from '../lib/auth';

const C = {
  canvas: '#0c1118',
  surface: 'rgba(17, 22, 31, 0.72)',
  text: '#eef1f6',
  muted: '#8a93a6',
  faint: '#5a6478',
  line: 'rgba(255, 255, 255, 0.08)',
  accent: '#03b0f7',
  accentSoft: '#8bddff',
};

const FEATURES = [
  {
    Icon: Truck,
    title: 'Real-time order sync',
    body: 'ShipStation orders refresh on a 15s heartbeat.',
  },
  {
    Icon: Boxes,
    title: 'Inventory & locations',
    body: 'Live stock counts across every bin and warehouse.',
  },
  {
    Icon: ShieldCheck,
    title: 'Secure access',
    body: 'Encrypted sessions with role-based permissions.',
  },
] as const;

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.loading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center" style={{ background: C.canvas, color: C.muted }}>
        Loading...
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
      navigate(from, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in';
      setError(/invalid login/i.test(message) ? 'Invalid email or password.' : message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        background:
          'radial-gradient(900px 700px at 78% 12%, rgba(3,176,247,0.08), transparent 60%), radial-gradient(1100px 800px at 12% 100%, rgba(50,70,100,0.10), transparent 65%), linear-gradient(180deg, #0c1118 0%, #0a0e15 100%)',
        color: C.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div className="pointer-events-none absolute right-6 top-6 z-20 hidden items-center gap-2.5 lg:flex" aria-live="polite">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: C.accent, boxShadow: '0 0 0 3px rgba(3, 176, 247, 0.18)' }}
          aria-hidden
        />
        <span className="text-[10px] uppercase tracking-[0.28em]" style={{ color: C.muted, fontFamily: 'ui-monospace, "JetBrains Mono", monospace' }}>
          All systems operational
        </span>
      </div>

      <div className="relative z-10 grid min-h-screen w-full grid-cols-1 lg:grid-cols-[3fr_2fr]">
        <section className="relative flex flex-col">
          <div className="flex flex-col items-center gap-6 px-6 pb-2 pt-8 lg:hidden">
            <Wordmark />
            <div className="w-full max-w-[260px]">
              <CobeGlobe />
            </div>
          </div>

          <div className="absolute left-12 top-12 hidden lg:block">
            <Wordmark />
          </div>

          <div className="relative hidden h-full flex-col justify-between p-12 lg:flex">
            <div aria-hidden />
            <div className="grid grid-cols-1 items-center gap-12 xl:grid-cols-[1fr_1fr]">
              <div className="max-w-md">
                <h1 className="text-[44px] font-medium leading-[1.05] tracking-[-0.02em]">
                  Ship faster.
                  <br />
                  <span style={{ color: C.accent }}>Stay ahead.</span>
                </h1>
                <p className="mt-5 max-w-sm text-sm leading-relaxed" style={{ color: C.muted }}>
                  Centralized order, inventory, and rate-shop tooling for the Dr Prepper fulfillment team - built for speed.
                </p>

                <ul className="mt-8 space-y-2">
                  {FEATURES.map((feature) => (
                    <li
                      key={feature.title}
                      className="group relative flex items-start gap-3.5 rounded-lg border border-transparent px-3 py-2.5 transition-all duration-300"
                      onMouseEnter={(event) => {
                        event.currentTarget.style.borderColor = C.line;
                        event.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.borderColor = 'transparent';
                        event.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span
                        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md"
                        style={{ border: `1px solid ${C.line}`, background: 'rgba(255,255,255,0.02)', color: C.accent }}
                        aria-hidden
                      >
                        <feature.Icon size={18} strokeWidth={1.6} />
                      </span>
                      <div>
                        <div className="text-[14px] font-medium" style={{ color: C.text }}>
                          {feature.title}
                        </div>
                        <div className="mt-0.5 text-[13px] leading-relaxed" style={{ color: C.muted }}>
                          {feature.body}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mx-auto w-full max-w-[440px]">
                <CobeGlobe />
              </div>
            </div>

            <div aria-hidden />
          </div>
        </section>

        <section className="relative flex items-center justify-center p-6 sm:p-10 lg:p-12">
          <div
            className="card-enter relative w-full max-w-[420px] rounded-2xl px-8 py-10"
            style={{
              background: `linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005)), ${C.surface}`,
              border: `1px solid ${C.line}`,
              backdropFilter: 'blur(10px) saturate(120%)',
              WebkitBackdropFilter: 'blur(10px) saturate(120%)',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-px h-24 rounded-t-2xl"
              style={{ background: 'radial-gradient(60% 80% at 50% 0%, rgba(3, 176, 247, 0.18), transparent 70%)' }}
            />

            <h2 className="relative text-[26px] font-medium leading-[1.15] tracking-[-0.015em]" style={{ color: C.text }}>
              Welcome back
            </h2>
            <p className="relative mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>
              Sign in with the portal access provided by DR PREPPER USA.
            </p>

            <form onSubmit={submit} className="relative mt-8 space-y-5">
              <DarkField
                label="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="you@drprepperusa.com"
                disabled={submitting}
                autoFocus
                required
                Icon={Mail}
              />

              <div>
                <DarkField
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="********"
                  disabled={submitting}
                  required
                  Icon={Lock}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="grid h-7 w-7 place-items-center transition-colors"
                      style={{ color: C.muted }}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <div className="mt-2 flex justify-end">
                  <Link to="/reset-password" className="text-[12px] font-medium transition-colors" style={{ color: C.accent }}>
                    Forgot?
                  </Link>
                </div>
              </div>

              {error ? (
                <div
                  className="rounded-lg border px-3 py-2 text-[13px]"
                  style={{ background: 'rgba(220, 50, 50, 0.08)', borderColor: 'rgba(220, 50, 50, 0.32)', color: '#ff8a92' }}
                  role="alert"
                >
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting || !email.trim() || !password}
                className="h-11 w-full rounded-lg text-[13px] font-medium uppercase tracking-[0.22em] transition-all duration-200 disabled:opacity-60"
                style={{ background: C.accent, border: `1px solid ${C.accent}`, color: C.canvas, fontFamily: 'ui-monospace, "JetBrains Mono", monospace' }}
              >
                <span className="flex items-center justify-center gap-2.5">
                  {submitting ? (
                    <>
                      <span
                        className="h-3 w-3 animate-spin rounded-full border-2"
                        style={{ borderColor: 'rgba(12,17,24,0.3)', borderTopColor: C.canvas }}
                        aria-hidden
                      />
                      <span>Signing in</span>
                    </>
                  ) : (
                    <span>Sign in</span>
                  )}
                </span>
              </button>
            </form>

            <div className="relative mt-8 text-center text-[13px]" style={{ color: C.muted }}>
              Portal access is invite-only and provisioned after your PrepShip client setup is complete.
            </div>
          </div>
        </section>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex items-center justify-center gap-4 px-6 lg:justify-between lg:px-12">
        <span className="text-[10px] tracking-[0.18em]" style={{ color: C.faint, fontFamily: 'ui-monospace, "JetBrains Mono", monospace' }}>
          © {new Date().getFullYear()} Dr Prepper USA - Gardena, CA
        </span>
      </div>

      <style>{`
        @keyframes card-enter {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .card-enter {
          animation: card-enter 450ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .card-enter { animation: none; }
        }
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px rgba(0, 0, 0, 0.25) inset !important;
          -webkit-text-fill-color: #eef1f6 !important;
          caret-color: #eef1f6 !important;
          transition: background-color 9999s ease-out, color 9999s ease-out !important;
          font: inherit !important;
        }
      `}</style>
    </main>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 40 40" fill="none" aria-hidden>
        <path d="M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z" stroke="rgba(255,255,255,0.42)" strokeWidth="1.2" />
        <path d="M14 16 L20 13 L26 16 L26 24 L20 27 L14 24 Z M20 13 V27 M14 16 L26 16" stroke={C.accent} strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div className="leading-none">
        <div className="text-2xl font-medium tracking-[-0.015em]" style={{ color: C.text }}>
          PrepShip
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.3em]" style={{ color: C.muted, fontFamily: 'ui-monospace, "JetBrains Mono", monospace' }}>
          Dr Prepper Fulfillment
        </div>
      </div>
    </div>
  );
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  Icon: typeof Mail;
  trailing?: React.ReactNode;
};

function DarkField({ label, Icon, trailing, ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium" style={{ color: C.muted }}>
        {label}
      </span>
      <div
        className="mt-1.5 flex items-center rounded-lg px-3 transition-colors focus-within:!border-[#03b0f7]"
        style={{ background: 'rgba(0, 0, 0, 0.25)', border: `1px solid ${C.line}` }}
      >
        <span style={{ color: C.muted }}>
          <Icon size={15} strokeWidth={1.8} aria-hidden />
        </span>
        <input {...rest} className="ml-2 h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:opacity-40" style={{ color: C.text }} />
        {trailing}
      </div>
    </label>
  );
}
