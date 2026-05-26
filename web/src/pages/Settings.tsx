import { FormEvent, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, Play, Save, ShieldCheck } from 'lucide-react';
import { EmptyState, ErrorNotice, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import type { BackfillMode, BackfillResponse, BackfillTarget } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  useBackfillMutation,
  useClientsQuery,
  useSetSettingMutation,
  useSettingsQuery,
  useSyncStatusQuery,
} from '../lib/portalQueries';

function clientRows(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  return [];
}

type SettingsSection = 'preferences' | 'backfill';

const backfillTasks: Array<{
  target: BackfillTarget;
  title: string;
  description: string;
}> = [
  {
    target: 'orders',
    title: 'Orders',
    description: 'Pull missing ShipStation order records and refresh dashboard/order lists.',
  },
  {
    target: 'shipments',
    title: 'Shipments',
    description: 'Backfill safe shipment history, tracking, carrier, and label metadata.',
  },
  {
    target: 'inventory-from-orders',
    title: 'Inventory from orders',
    description: 'Create missing SKU inventory records from synced order line items.',
  },
  {
    target: 'products',
    title: 'Product catalog',
    description: 'Refresh product/SKU details from ShipStation without changing shipped history.',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readNestedDate(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' ? current : null;
}

function displayDateTime(value: string | null | undefined) {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function summarizePayload(value: unknown) {
  if (!isRecord(value)) return 'Completed';
  const preferredKeys = ['synced', 'created', 'updated', 'inserted', 'count', 'total', 'skipped'];
  const parts = preferredKeys
    .map((key) => {
      const entry = value[key];
      return typeof entry === 'number' || typeof entry === 'string' ? `${key}: ${entry}` : null;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Completed';
}

function canWriteSettings(auth: ReturnType<typeof useAuth>) {
  if (auth.isDemo) return true;
  const metadata = (auth.user?.app_metadata ?? {}) as { role?: string; permissions?: string[] };
  return metadata.role === 'admin' || metadata.role === 'operator' || metadata.permissions?.includes('settings:write') === true;
}

function BackfillResultList({ result }: { result: BackfillResponse | null }) {
  if (!result) return null;
  return (
    <div className="mt-5 rounded-xl bg-surface-2 p-4 ring-1 ring-line">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-ink">Last run result</div>
          <div className="text-xs font-semibold text-ink-3">
            {result.target.replace(/-/g, ' ')} · {result.mode} · finished {displayDateTime(result.finishedAt)}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${
            result.ok ? 'bg-ok-bg text-ok' : 'bg-danger-bg text-danger'
          }`}
        >
          {result.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {result.ok ? 'Complete' : 'Needs review'}
        </span>
      </div>
      <div className="space-y-2">
        {result.results.map((row) => (
          <div key={row.target} className="flex flex-col gap-1 rounded-lg bg-surface px-3 py-2 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-black capitalize text-ink">{row.target.replace(/-/g, ' ')}</div>
            <div className={`text-xs font-bold ${row.ok ? 'text-ink-3' : 'text-danger'}`}>
              {row.ok ? summarizePayload(row.data) : row.error ?? 'Failed'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const auth = useAuth();
  const clients = useClientsQuery(auth.accessToken);
  const settings = useSettingsQuery(auth.accessToken);
  const syncStatus = useSyncStatusQuery(auth.accessToken);
  const saveSetting = useSetSettingMutation(auth.accessToken);
  const backfill = useBackfillMutation(auth.accessToken);
  const [section, setSection] = useState<SettingsSection>('preferences');
  const [backfillMode, setBackfillMode] = useState<BackfillMode>('incremental');
  const [runningTarget, setRunningTarget] = useState<BackfillTarget | null>(null);
  const [lastBackfillResult, setLastBackfillResult] = useState<BackfillResponse | null>(null);
  const [defaultView, setDefaultView] = useState('dashboard');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignedClients = clientRows(clients.data);
  const rows = settings.data?.data ?? [];
  const canBackfill = canWriteSettings(auth);
  const statusCards = useMemo(
    () => [
      {
        label: 'Orders',
        value: displayDateTime(
          readNestedDate(syncStatus.data, ['orders', 'lastSyncedAt']) ?? readNestedDate(syncStatus.data, ['lastSyncAt'])
        ),
      },
      {
        label: 'Shipments',
        value: displayDateTime(readNestedDate(syncStatus.data, ['shipments', 'lastSyncedAt'])),
      },
      {
        label: 'Worker',
        value: isRecord(syncStatus.data?.worker) && syncStatus.data.worker.stale === true ? 'Stale' : 'Ready',
      },
      {
        label: 'Queue',
        value: isRecord(syncStatus.data?.queue) && syncStatus.data.queue.enabled === true ? 'Enabled' : 'Checking',
      },
    ],
    [syncStatus.data]
  );

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

  async function runBackfill(target: BackfillTarget) {
    if (!auth.accessToken) return;
    setError(null);
    setMessage(null);
    setRunningTarget(target);
    try {
      const result = await backfill.mutateAsync({ target, mode: backfillMode });
      setLastBackfillResult(result);
      setMessage(`${target === 'all' ? 'All backfill tasks' : target.replace(/-/g, ' ')} finished.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningTarget(null);
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

      <div className="mb-6 inline-flex rounded-xl bg-surface p-1 ring-1 ring-line">
        {[
          ['preferences', 'Preferences'],
          ['backfill', 'Backfill'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSection(value as SettingsSection)}
            className={`rounded-lg px-4 py-2 text-xs font-black transition-all duration-200 ease-out ${
              section === value
                ? 'bg-brand text-white shadow-sm'
                : 'text-ink-2 hover:bg-brand-bg hover:text-brand'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'preferences' ? (
        <>
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
      ) : (
        <Panel
          title="Backfill sync"
          right={
            <span className="inline-flex items-center gap-1.5 text-xs font-black text-brand">
              <DatabaseZap size={14} />
              Manual sync controls
            </span>
          }
        >
          <div className="space-y-6 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {statusCards.map((card) => (
                <div key={card.label} className="rounded-xl bg-surface-2 p-4 ring-1 ring-line">
                  <div className="text-[11px] font-black uppercase text-ink-3">{card.label}</div>
                  <div className="mt-2 text-sm font-black text-ink">{syncStatus.isLoading ? 'Loading...' : card.value}</div>
                </div>
              ))}
            </div>

            {!canBackfill ? (
              <div className="rounded-xl bg-warn-bg p-4 text-sm font-semibold text-warn ring-1 ring-warn-border">
                Backfill is visible for audit, but your current role only has settings:read. Ask an admin for settings:write to run syncs.
              </div>
            ) : null}

            <div className="flex flex-col justify-between gap-4 rounded-xl bg-brand-bg p-4 ring-1 ring-brand/15 md:flex-row md:items-center">
              <div>
                <div className="text-sm font-black text-ink">Sync mode</div>
                <div className="mt-1 text-sm font-medium text-ink-2">
                  Incremental is fastest. Full historical backfill starts from the beginning where the backend supports it.
                </div>
              </div>
              <div className="inline-flex rounded-xl bg-surface p-1 ring-1 ring-line">
                {(['incremental', 'full'] as BackfillMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setBackfillMode(mode)}
                    className={`rounded-lg px-4 py-2 text-xs font-black capitalize transition-all duration-200 ${
                      backfillMode === mode ? 'bg-brand text-white shadow-sm' : 'text-ink-2 hover:bg-brand-bg hover:text-brand'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {backfillTasks.map((task) => {
                const isRunning = backfill.isPending && runningTarget === task.target;
                return (
                  <div key={task.target} className="rounded-xl bg-surface p-4 ring-1 ring-line transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-sm motion-reduce:transform-none">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-black text-ink">{task.title}</div>
                        <div className="mt-1 text-sm leading-6 text-ink-2">{task.description}</div>
                      </div>
                      <Clock3 size={18} className="shrink-0 text-brand" />
                    </div>
                    <button
                      type="button"
                      onClick={() => void runBackfill(task.target)}
                      disabled={!canBackfill || backfill.isPending}
                      className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-surface text-sm font-black text-ink ring-1 ring-line transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand hover:text-white active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transform-none"
                    >
                      <Play size={15} />
                      {isRunning ? 'Running...' : `Run ${task.title}`}
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => void runBackfill('all')}
              disabled={!canBackfill || backfill.isPending}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-black text-white shadow-sm shadow-brand/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-dark active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transform-none"
            >
              <DatabaseZap size={17} />
              {backfill.isPending && runningTarget === 'all' ? 'Running all backfill tasks...' : 'Run all backfill tasks'}
            </button>

            <BackfillResultList result={lastBackfillResult} />
          </div>
        </Panel>
      )}
    </>
  );
}
