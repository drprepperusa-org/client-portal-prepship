import { useState } from 'react';
import { Link } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function CopyAuditView({ getUrl, disabled }: { getUrl: () => string; disabled: boolean }) {
  const [result, setResult] = useState<{ url: string; copied: boolean } | null>(null);
  async function copy() {
    const url = getUrl();
    try {
      await navigator.clipboard.writeText(url);
      setResult({ url, copied: true });
    } catch {
      setResult({ url, copied: false });
    }
  }
  return <div className="space-y-2">
    <Button variant="secondary" size="sm" disabled={disabled} leadingIcon={<Link size={15} />} onClick={() => void copy()}>Copy view link</Button>
    {result && <p role="status" className="text-xs text-ink-2">
      {result.copied ? 'View link copied. Admin access is required to open it.' : 'Could not copy automatically. Select and copy the link below.'}
    </p>}
    {result && !result.copied && <input aria-label="Audit view link" readOnly value={result.url}
      onFocus={event => event.target.select()} className="focus-ring w-full rounded-lg border border-slate-200 p-2 text-sm" />}
  </div>;
}
