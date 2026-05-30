import { lazy, Suspense, type JSX } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { useAuth } from './auth';
import { useMe } from './lib/hooks';

// Eager: the login screen is the entry point for unauthenticated users.
import Login from './pages/Login';

// Lazy: each authenticated page is its own chunk, loaded on navigation.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const Inbound = lazy(() => import('./pages/Inbound'));
const Shipments = lazy(() => import('./pages/Shipments'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Finance = lazy(() => import('./pages/Finance'));
const Billing = lazy(() => import('./pages/Billing'));
const Rates = lazy(() => import('./pages/Rates'));
const Connections = lazy(() => import('./pages/Connections'));
const Settings = lazy(() => import('./pages/Settings'));
const Components = lazy(() => import('./pages/Components'));

function Spinner({ label }: { label: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-3">
        <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
        <p className="text-sm text-ink-3">{label}</p>
      </div>
    </div>
  );
}

function AuthSplash() {
  return <Spinner label="Loading your portal…" />;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthed, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AuthSplash />;
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

/** Admin-only route guard. Settings is restricted to admins (e.g.
 *  admin@drprepper.com); non-admins are redirected to the dashboard. The
 *  server independently enforces admin scope on the underlying endpoints. */
function RequireAdmin({ children }: { children: JSX.Element }) {
  const me = useMe();
  if (me.isLoading) return <Spinner label="Loading…" />;
  if (!me.data?.isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { isAuthed, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <AuthSplash /> : isAuthed ? <Navigate to="/" replace /> : <Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          path="/"
          element={
            <Suspense fallback={<Spinner label="Loading…" />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route path="/orders" element={<Lazy el={<Orders />} />} />
        <Route path="/inbound" element={<Lazy el={<Inbound />} />} />
        <Route path="/shipments" element={<Lazy el={<Shipments />} />} />
        <Route path="/inventory" element={<Lazy el={<Inventory />} />} />
        <Route path="/analysis" element={<Lazy el={<Analysis />} />} />
        <Route path="/finance" element={<Lazy el={<Finance />} />} />
        <Route path="/billing" element={<Lazy el={<Billing />} />} />
        {/* Reports + Invoices were merged into Billing — keep old links working. */}
        <Route path="/reports" element={<Navigate to="/billing" replace />} />
        <Route path="/invoices" element={<Navigate to="/billing" replace />} />
        <Route path="/rates" element={<Lazy el={<Rates />} />} />
        <Route path="/connections" element={<Lazy el={<Connections />} />} />
        <Route path="/settings" element={<RequireAdmin><Lazy el={<Settings />} /></RequireAdmin>} />
        <Route path="/components" element={<Lazy el={<Components />} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Wraps a lazy page in a Suspense boundary with a consistent fallback. */
function Lazy({ el }: { el: JSX.Element }) {
  return <Suspense fallback={<Spinner label="Loading…" />}>{el}</Suspense>;
}
