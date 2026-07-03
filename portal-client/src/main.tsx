import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './auth';
import { PortalFiltersProvider } from './lib/portalContext';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import './index.css';

// Tuned for snappy navigation: data is considered fresh for 5 min, kept in
// cache for 30 min, and NOT refetched on every mount/focus — so revisiting a
// page renders instantly from cache (mirrors prepship-v4-stable).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      // Render can cold-start (the API spins up on the first request after
      // idle), so a call may need a couple of tries before the server is awake.
      // Retry transient failures (network / timeout / 5xx) twice with a short
      // backoff so a waking API self-heals; do NOT retry expected client errors
      // (401/403/404) — they won't change and aren't a connection problem. The
      // 30s client timeout in api.ts covers the wake-up window per attempt.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});

// Stale-bundle auto-recovery: after a deploy, an old tab may request a chunk
// filename that no longer exists. Vite fires `vite:preloadError`; we hard-reload
// once (guarded against loops) to pull the new index.html.
const RELOAD_FLAG = 'prepship.preloadErrorReload';
function reloadOnceForStaleBundle() {
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
}
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  reloadOnceForStaleBundle();
});
window.addEventListener('load', () => {
  window.setTimeout(() => sessionStorage.removeItem(RELOAD_FLAG), 5_000);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PortalFiltersProvider>
            <ToastProvider>
              <ChunkErrorBoundary>
                <App />
              </ChunkErrorBoundary>
            </ToastProvider>
          </PortalFiltersProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
