import { FormEvent, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { EmptyState, ErrorNotice, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { useAuth } from '../lib/auth';
import { useClientsQuery, useSetSettingMutation, useSettingsQuery } from '../lib/portalQueries';

function clientRows(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  return [];
}

export default function Settings() {
  const auth = useAuth();
  const clients = useClientsQuery(auth.accessToken);
  const settings = useSettingsQuery(auth.accessToken);
  const saveSetting = useSetSettingMutation(auth.accessToken);
  const [defaultView, setDefaultView] = useState('dashboard');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignedClients = clientRows(clients.data);
  const rows = settings.data?.data ?? [];

  async function saveDefaultView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth.accessToken) return;
    setError(null);
    setMessage(null);
    try {
      await saveSetting.mutateAsync({ key: 'defaultView', value: defaultView });
      setMessage('Default view saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Account, client scope, and allowed portal preferences."
        action={<RefreshButton loading={clients.isFetching || settings.isFetching} onClick={() => { void clients.refetch(); void settings.refetch(); }} />}
      />
      {clients.error ? <div className="mb-5"><ErrorPanel message={clients.error instanceof Error ? clients.error.message : String(clients.error)} loading={clients.isFetching} onRetry={() => void clients.refetch()} /></div> : null}
      {settings.error ? <div className="mb-5"><ErrorPanel message={settings.error instanceof Error ? settings.error.message : String(settings.error)} loading={settings.isFetching} onRetry={() => void settings.refetch()} /></div> : null}
      {error ? <div className="mb-5"><ErrorNotice message={error} /></div> : null}
      {message ? <div className="portal-alert portal-alert-ok">{message}</div> : null}

      <div className="portal-grid-2">
        <Panel title="Portal account">
          <div className="portal-settings-card">
            <div className="portal-settings-avatar">{auth.user?.email?.slice(0, 1).toUpperCase() ?? 'D'}</div>
            <div>
              <div className="portal-settings-name">{auth.user?.user_metadata?.name ?? 'Drprepper'}</div>
              <div className="portal-settings-email">{auth.user?.email ?? 'client@drprepperusa.org'}</div>
              <div className="portal-settings-role"><ShieldCheck size={14} /> client_user scoped access</div>
            </div>
          </div>
        </Panel>

        <Panel title="Preference">
          <form className="portal-settings-form" onSubmit={saveDefaultView}>
            <label>
              Default landing page
              <select value={defaultView} onChange={(event) => setDefaultView(event.target.value)}>
                <option value="dashboard">Dashboard</option>
                <option value="orders">Orders</option>
                <option value="inventory">Inventory</option>
                <option value="shipments">Shipments</option>
              </select>
            </label>
            <button type="submit" disabled={saveSetting.isPending}>
              <Save size={15} /> {saveSetting.isPending ? 'Saving...' : 'Save'}
            </button>
          </form>
        </Panel>
      </div>

      <div className="portal-grid-2 mt-6">
        <Panel title="Assigned clients" right={<span className="text-xs font-bold text-ink-3">{assignedClients.length} client(s)</span>}>
          {clients.isLoading && !clients.data ? <TableSkeleton rows={4} columns={3} /> : <div className="divide-y divide-line">
            {assignedClients.map((client, index) => {
              const record = client as { id?: number; name?: string | null; email?: string | null; active?: boolean | null };
              return (
                <div key={record.id ?? index} className="portal-settings-row">
                  <div>
                    <strong>{record.name ?? `Client ${record.id ?? index + 1}`}</strong>
                    <span>{record.email ?? 'Scoped through Supabase JWT claims'}</span>
                  </div>
                  <em>{record.active === false ? 'Inactive' : 'Active'}</em>
                </div>
              );
            })}
          </div>}
          {!clients.isLoading && assignedClients.length === 0 ? <EmptyState title="No client rows returned" body="Your backend may be enforcing claim-only access for this portal user." /> : null}
        </Panel>

        <Panel title="Readable settings" right={<span className="text-xs font-bold text-ink-3">{rows.length} setting(s)</span>}>
          {settings.isLoading && !settings.data ? <TableSkeleton rows={4} columns={2} /> : <div className="divide-y divide-line">
            {rows.map((row, index) => (
              <div key={row.key ?? index} className="portal-settings-row">
                <div>
                  <strong>{row.key ?? `Setting ${index + 1}`}</strong>
                  <span>{row.value ?? 'No value'}</span>
                </div>
              </div>
            ))}
          </div>}
          {!settings.isLoading && rows.length === 0 ? <EmptyState title="No readable settings" body="Settings appear only when the backend grants settings:read to your role." /> : null}
        </Panel>
      </div>
    </>
  );
}
