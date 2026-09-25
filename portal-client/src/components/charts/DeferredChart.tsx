import { Component, Suspense, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/Display';

/** Isolate optional visualization downloads from the surrounding data and controls. */
export class DeferredChart extends Component<{ children: ReactNode; height?: number }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const height = this.props.height ?? 260;
    if (this.state.failed) {
      return (
        <div role="alert" className="grid place-content-center gap-2 text-center text-sm text-ink-3" style={{ minHeight: height }}>
          <p>Chart could not load. Your other page data is still available.</p>
          <button type="button" className="focus-ring rounded-lg px-3 py-2 font-semibold text-brand-700" onClick={() => window.location.reload()}>
            Reload chart
          </button>
        </div>
      );
    }
    return (
      <Suspense fallback={<div role="status" aria-label="Loading chart" style={{ height }}><Skeleton className="h-full" /></div>}>
        {this.props.children}
      </Suspense>
    );
  }
}
