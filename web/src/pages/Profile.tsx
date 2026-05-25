import { PageHeader, Panel } from '../components/PortalPrimitives';
import { useAuth } from '../lib/auth';

export default function Profile() {
  const auth = useAuth();
  const metadata = auth.user?.app_metadata as Record<string, unknown> | undefined;

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Your account metadata controls what client and store data this portal can read."
      />
      <Panel title="Account scope">
        <dl className="grid gap-4 px-5 py-5 md:grid-cols-2">
          <div>
            <dt className="text-[11px] font-black uppercase text-ink-3">Email</dt>
            <dd className="mt-1 text-sm font-bold text-ink">{auth.user?.email ?? '-'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-black uppercase text-ink-3">Role</dt>
            <dd className="mt-1 text-sm font-bold text-ink">{String(metadata?.role ?? 'client_user')}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-black uppercase text-ink-3">Client IDs</dt>
            <dd className="mt-1 text-sm font-bold text-ink">{JSON.stringify(metadata?.clientIds ?? metadata?.client_ids ?? [])}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-black uppercase text-ink-3">Store IDs</dt>
            <dd className="mt-1 text-sm font-bold text-ink">{JSON.stringify(metadata?.storeIds ?? metadata?.store_ids ?? [])}</dd>
          </div>
        </dl>
      </Panel>
    </>
  );
}
