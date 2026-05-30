import { Component, type ReactNode } from 'react';

/**
 * Catches React.lazy chunk-load failures (e.g. a stale tab after a new deploy
 * fetches a chunk filename that no longer exists). Mirrors v4-stable's
 * ChunkErrorBoundary: it must wrap <Suspense> so the lazy-import rejection —
 * which Suspense rethrows during render — is caught above the reconciler.
 */
interface State {
  failed: boolean;
}

const RELOAD_FLAG = 'prepship.chunkErrorReload';

export class ChunkErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const message = String((error as { message?: unknown } | null)?.message ?? error ?? '');
    const isChunkError =
      /Failed to fetch dynamically imported module/i.test(message) ||
      /Loading chunk \S+ failed/i.test(message) ||
      /Importing a module script failed/i.test(message);
    if (isChunkError && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="grid min-h-screen place-items-center p-6 text-center">
          <div>
            <p className="font-display text-lg font-semibold text-ink">Something needs a refresh</p>
            <p className="mt-1 text-sm text-ink-3">A newer version may be available.</p>
            <button
              onClick={() => {
                sessionStorage.removeItem(RELOAD_FLAG);
                window.location.reload();
              }}
              className="focus-ring mt-4 cursor-pointer rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
