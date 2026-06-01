import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PackageCheck, Mail, Lock, ArrowRight, Truck, MapPin, Boxes, Clock, ShieldCheck, Plug } from 'lucide-react';
import { EmailInput, PasswordInput } from '@/components/ui/Inputs';
import { Checkbox } from '@/components/ui/Selection';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, pw);
      toast.success('Welcome back', 'Signed in successfully.');
      nav(from, { replace: true });
    } catch (err) {
      toast.error('Sign in failed', err instanceof Error ? err.message : 'Check your email and password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      {/* ============ Left: branded graphic panel ============ */}
      <BrandPanel />

      {/* ============ Right: sign-in form ============ */}
      <div className="relative flex items-center justify-center bg-white px-5 py-10 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 26 }}
          className="w-full max-w-sm"
        >
          {/* Mobile brand mark (panel is hidden on small screens) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass">
              <PackageCheck size={20} />
            </span>
            <div className="leading-tight">
              <p className="font-display text-base font-bold tracking-tight text-ink">PrepShip</p>
              <p className="text-[11px] font-medium text-ink-3">Client Portal</p>
            </div>
          </div>

          <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Welcome back</h1>
          <p className="mt-1.5 text-sm text-ink-3">Sign in to your fulfillment portal</p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
            <EmailInput label="Email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} icon={<Mail size={16} />} placeholder="you@company.com" />
            <PasswordInput label="Password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} icon={<Lock size={16} />} placeholder="••••••••" />

            <div className="flex items-center justify-between">
              <Checkbox label="Remember me" checked={remember} onChange={setRemember} />
              <button type="button" className="focus-ring cursor-pointer rounded text-sm font-medium text-brand-600 transition-colors hover:text-brand-700">
                Forgot password?
              </button>
            </div>

            <Button type="submit" size="lg" loading={loading} className="mt-1 w-full" trailingIcon={<ArrowRight size={18} />}>
              Sign In
            </Button>
          </form>

          <div className="mt-6 flex items-center gap-3 text-xs text-ink-3">
            <span className="h-px flex-1 bg-slate-200" />
            <span>Secure client access</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <p className="mt-6 text-center text-xs text-ink-3">
            Don't have an account? <span className="cursor-pointer font-semibold text-brand-600">Contact your account manager</span>
          </p>
        </motion.div>
      </div>
    </div>
  );
}

/* ===================== Branded graphic panel ===================== */
function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-600 to-violet-700 lg:flex lg:flex-col">
      {/* Decorative grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(120% 80% at 50% 0%, #000 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(120% 80% at 50% 0%, #000 40%, transparent 100%)',
        }}
      />
      {/* Soft glow blobs (within the brand panel only) */}
      <div aria-hidden className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-white/15 blur-3xl" />
      <div aria-hidden className="absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-violet-400/25 blur-3xl" />

      {/* Logo */}
      <div className="relative z-10 flex items-center gap-3 p-10">
        <span className="grid h-11 w-11 place-items-center rounded-glass-sm bg-white/15 text-white ring-1 ring-white/30 backdrop-blur">
          <PackageCheck size={22} />
        </span>
        <div className="leading-tight">
          <p className="font-display text-lg font-bold tracking-tight text-white">PrepShip</p>
          <p className="text-xs font-medium text-white/70">Client Portal</p>
        </div>
      </div>

      {/* Headline */}
      <div className="relative z-10 px-10">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="font-display text-4xl font-bold leading-tight tracking-tight text-white text-balance"
        >
          Ship smarter.
          <br />
          Scale faster.
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mt-3 max-w-md text-[15px] leading-relaxed text-white/80"
        >
          Your orders, inventory, shipments and billing — unified in one effortless fulfillment command center.
        </motion.p>
      </div>

      {/* Route illustration */}
      <div className="relative z-10 mt-6 flex-1">
        <RouteGraphic />
      </div>

      {/* Trust stats */}
      <div className="relative z-10 grid grid-cols-3 gap-3 p-10 pt-0">
        {[
          { icon: Boxes, label: '2.4M+ units shipped' },
          { icon: Clock, label: '99.2% on-time' },
          { icon: ShieldCheck, label: 'SOC 2 secure' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.08 }}
            className="rounded-glass-sm border border-white/15 bg-white/10 p-3 backdrop-blur"
          >
            <s.icon size={18} className="text-white/90" />
            <p className="mt-2 text-[13px] font-semibold leading-tight text-white">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* Animated shipping-route SVG with floating glass cards riding above it. */
function RouteGraphic() {
  return (
    <div className="relative h-full min-h-[220px] w-full">
      <svg viewBox="0 0 600 240" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
        {/* dashed route path */}
        <motion.path
          d="M60 180 C 160 60, 260 60, 340 130 S 500 200, 540 70"
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="2.5"
          strokeDasharray="6 8"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ delay: 0.3, duration: 1.6, ease: 'easeInOut' }}
        />
        {/* origin + destination nodes */}
        {[
          { x: 60, y: 180 },
          { x: 340, y: 130 },
          { x: 540, y: 70 },
        ].map((p, i) => (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="7"
            fill="#fff"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.6 + i * 0.3, type: 'spring', stiffness: 400, damping: 16 }}
          />
        ))}
        {/* pulse ring on destination */}
        <motion.circle
          cx="540"
          cy="70"
          r="7"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: [1, 2.6], opacity: [0.8, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: 1.4 }}
          style={{ transformOrigin: '540px 70px' }}
        />
        {/* package riding the route (keyframed along the waypoints) */}
        <motion.circle
          r="9"
          fill="#fff"
          initial={{ cx: 60, cy: 180 }}
          animate={{
            cx: [60, 200, 340, 460, 540],
            cy: [180, 70, 130, 150, 70],
          }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
        />
        <motion.circle
          r="9"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          initial={{ cx: 60, cy: 180, opacity: 0.5 }}
          animate={{
            cx: [60, 200, 340, 460, 540],
            cy: [180, 70, 130, 150, 70],
            scale: [1, 1.8, 1, 1.8, 1],
            opacity: [0.5, 0, 0.5, 0, 0.5],
          }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
        />
      </svg>

      {/* Floating glass info cards */}
      <FloatCard className="left-6 top-2" delay={0.9} icon={<Truck size={15} />} title="Order PS-24817" subtitle="Out for delivery · Denver" />
      <FloatCard className="bottom-6 right-8" delay={1.2} icon={<MapPin size={15} />} title="98.3% fulfillment" subtitle="This week · on target" />
      <FloatCard className="bottom-20 left-10" delay={1.5} icon={<Plug size={15} />} title="4 channels synced" subtitle="Shopify · Amazon · eBay" />
    </div>
  );
}

function FloatCard({ className, delay, icon, title, subtitle }: { className?: string; delay: number; icon: ReactNode; title: string; subtitle: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: 'spring', stiffness: 220, damping: 22 }}
      className={`absolute ${className ?? ''}`}
    >
      <motion.div
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 4 + delay, repeat: Infinity, ease: 'easeInOut' }}
        className="flex items-center gap-2.5 rounded-glass-sm border border-white/25 bg-white/15 px-3 py-2.5 shadow-lg backdrop-blur-md"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/90 text-brand-600">{icon}</span>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold text-white">{title}</p>
          <p className="text-[11px] text-white/70">{subtitle}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
