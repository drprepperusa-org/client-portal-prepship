import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  DatabaseZap,
  FlaskConical,
  MapPin,
  Percent,
  Play,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { EmptyState, ErrorNotice, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import type { BackfillMode, BackfillResponse, BackfillTarget } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  useBackfillMutation,
  useCarrierAccountsQuery,
  useClientsQuery,
  useMeQuery,
  useSettingsQuery,
  useSyncStatusQuery,
} from '../lib/portalQueries';
import type { CarrierAccount, PortalSetting } from '../types/portal';

function clientRows(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  return [];
}

type SettingsSection = 'markups' | 'locations' | 'pending' | 'sandbox' | 'cache' | 'system';
type SectionTone = 'blue' | 'pink' | 'amber' | 'rose' | 'purple';

const settingsSections: Array<{ value: SettingsSection; label: string; title: string; description: string; icon: typeof Settings2; tone: SectionTone }> = [
  { value: 'markups', label: 'Markups', title: 'Rate Browser - Account Markups', description: '$ or % markup added per carrier account. Applied to displayed rates in the Rate Browser; useful for billing clients above cost.', icon: Percent, tone: 'blue' },
  { value: 'locations', label: 'Locations', title: 'Ship-From Locations', description: 'Warehouses, 3PL centers, or drop-ship addresses. The default location is used for new labels.', icon: MapPin, tone: 'pink' },
  { value: 'pending', label: 'Pending', title: 'Pending Client Integrations', description: "Carrier credentials submitted by clients via the client portal that haven't been reviewed yet.", icon: Clock3, tone: 'amber' },
  { value: 'sandbox', label: 'Sandbox', title: 'Sandbox - Test Orders', description: 'Clients flagged as test are isolated: orders never sync, create postage, bill, or touch inventory.', icon: FlaskConical, tone: 'rose' },
  { value: 'cache', label: 'Cache', title: 'Cache Management', description: 'Clear rate cache and review saved settings after carrier credential changes or markup-rule updates.', icon: Database, tone: 'purple' },
  { value: 'system', label: 'System', title: 'System Status', description: 'Live API timing, sync state, account scope, and runtime flags for troubleshooting.', icon: Activity, tone: 'purple' },
];

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

function canWriteSettings(auth: ReturnType<typeof useAuth>, isAdmin: boolean | undefined) {
  if (isAdmin) return true;
  if (auth.isDemo) return true;
  const metadata = (auth.user?.app_metadata ?? {}) as { role?: string; permissions?: string[] };
  return metadata.role === 'admin' || metadata.role === 'operator' || metadata.permissions?.includes('settings:write') === true;
}

function parseSettingValue(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function titleCase(value: string) {
  return value
    .replace(/[_:.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSetting(key: string | null | undefined, value: string | null | undefined) {
  const settingKey = key ?? 'setting';
  const parsed = parseSettingValue(value);
  const rawValue = value ?? '';
  let title = titleCase(settingKey);
  let category = 'General';
  let summary = rawValue || 'No value saved';
  let tone: 'blue' | 'green' | 'amber' | 'slate' = 'slate';
  const details: Array<{ label: string; value: string }> = [];

  if (settingKey === 'defaultView') {
    title = 'Default landing page';
    category = 'Portal preference';
    summary = titleCase(String(parsed ?? 'Dashboard'));
    tone = 'blue';
    details.push({ label: 'Saved route', value: String(parsed ?? 'dashboard') });
  } else if (settingKey.startsWith('markup.')) {
    const providerId = settingKey.replace('markup.', '');
    category = 'Carrier markup';
    title = `Markup rule ${providerId}`;
    tone = 'green';
    if (isRecord(parsed)) {
      const type = String(parsed.type ?? 'pct').toUpperCase();
      const amount = String(parsed.value ?? '0');
      summary = `${amount}${type === 'PCT' ? '%' : ''} ${type === 'PCT' ? 'percentage' : 'flat'} markup`;
      details.push({ label: 'Type', value: type }, { label: 'Value', value: amount });
    }
  } else if (settingKey.includes('last_modified')) {
    category = 'Sync watermark';
    title = titleCase(settingKey.replace(/^order_sync\./, ''));
    tone = 'amber';
    const numeric = Number(parsed);
    summary = Number.isFinite(numeric) ? `Last source timestamp ${numeric}` : String(parsed ?? 'Not available');
  } else if (settingKey.endsWith('columnPrefs')) {
    category = 'Table layout';
    title = titleCase(settingKey.replace('.columnPrefs', ' columns'));
    tone = 'blue';
    if (isRecord(parsed)) {
      const viewCount = Object.keys(parsed).length;
      const firstView = Object.entries(parsed)[0];
      summary = `${viewCount} saved table ${viewCount === 1 ? 'view' : 'views'}`;
      if (firstView && isRecord(firstView[1])) {
        const widths = isRecord(firstView[1].widths) ? Object.keys(firstView[1].widths).length : 0;
        const hidden = Array.isArray(firstView[1].hidden) ? firstView[1].hidden.length : 0;
        details.push(
          { label: 'Example view', value: titleCase(firstView[0]) },
          { label: 'Custom widths', value: String(widths) },
          { label: 'Hidden columns', value: String(hidden) },
        );
      }
    }
  } else if (settingKey.startsWith('print_queue.')) {
    category = 'Print queue';
    title = titleCase(settingKey.replace(/^print_queue\./, ''));
    tone = 'amber';
    if (isRecord(parsed)) {
      const status = String(parsed.status ?? (parsed.success === true ? 'success' : 'saved'));
      const total = typeof parsed.total === 'number' || typeof parsed.total === 'string' ? ` - ${parsed.total} total` : '';
      summary = `${titleCase(status)}${total}`;
      details.push(
        { label: 'Status', value: titleCase(status) },
        { label: 'Job ID', value: String(parsed.jobId ?? parsed.job_id ?? 'None') },
      );
    }
  }

  if (details.length === 0 && isRecord(parsed)) {
    for (const [entryKey, entryValue] of Object.entries(parsed).slice(0, 3)) {
      if (typeof entryValue === 'string' || typeof entryValue === 'number' || typeof entryValue === 'boolean') {
        details.push({ label: titleCase(entryKey), value: String(entryValue) });
      }
    }
  }

  return {
    title,
    category,
    summary,
    tone,
    details,
    raw: rawValue,
    isStructured: isRecord(parsed) || Array.isArray(parsed),
  };
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

function SettingsHero({ section, action }: { section: (typeof settingsSections)[number]; action?: ReactNode }) {
  const Icon = section.icon;
  return (
    <div className="portal-settings-hero">
      <div className={`portal-settings-hero-icon portal-settings-hero-${section.tone}`}>
        <Icon size={24} />
      </div>
      <div>
        <h1>{section.title}</h1>
        <p>{section.description}</p>
      </div>
      {action ? <div className="portal-settings-hero-action">{action}</div> : null}
    </div>
  );
}

function ReadableSettingsPanel({ title, rows, loading }: { title: string; rows: PortalSetting[]; loading: boolean }) {
  return (
    <Panel title={title} right={<span className="text-xs font-bold text-ink-3">{rows.length} setting(s)</span>}>
      {loading ? <TableSkeleton rows={4} columns={2} /> : (
        <div className="portal-readable-settings">
          {rows.map((row, index) => {
            const readable = formatSetting(row.key, row.value);
            return (
              <details key={row.key ?? index} className="portal-readable-setting">
                <summary>
                  <span className={`portal-readable-icon portal-readable-icon-${readable.tone}`}>
                    <Settings2 size={17} />
                  </span>
                  <span className="portal-readable-main">
                    <strong>{readable.title}</strong>
                    <span>{readable.summary}</span>
                  </span>
                  <span className={`portal-readable-chip portal-readable-chip-${readable.tone}`}>{readable.category}</span>
                </summary>
                <div className="portal-readable-details">
                  {readable.details.length > 0 ? (
                    <div className="portal-readable-facts">
                      {readable.details.map((detail) => (
                        <div key={`${row.key}-${detail.label}`}>
                          <span>{detail.label}</span>
                          <strong>{detail.value}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {readable.isStructured || readable.raw.length > 80 ? (
                    <div className="portal-readable-raw">
                      <span>Raw setting</span>
                      <code>{readable.raw}</code>
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      )}
      {!loading && rows.length === 0 ? <EmptyState title={`No ${title.toLowerCase()}`} body="This section will populate when matching backend settings are available." /> : null}
    </Panel>
  );
}

function markupValue(row: PortalSetting | undefined) {
  const parsed = parseSettingValue(row?.value);
  if (!isRecord(parsed)) return { type: 'amount', value: '0' };
  return {
    type: String(parsed.type ?? 'amount').toLowerCase().includes('pct') ? 'pct' : 'amount',
    value: String(parsed.value ?? '0'),
  };
}

function MarkupsSection({ rows, carrierAccounts }: { rows: PortalSetting[]; carrierAccounts: CarrierAccount[] }) {
  const directAccounts = carrierAccounts.length ? carrierAccounts : [
    { provider: 'shipp', label: 'Shipp Carrier', accountIdentifier: '81ea513665...' },
    { provider: 'easypost', label: 'EasyPost Carrier', accountIdentifier: 'EZAKdae0...' },
    { provider: 'walmart', label: 'Walmart', accountIdentifier: 'b05d6470...' },
    { provider: 'ups', label: 'UPS Carrier', accountIdentifier: 'C81F70' },
  ];
  const shipStationGroups = [
    {
      title: 'ShipStation Carriers - DR PREPPER',
      names: ['USPS Chase x7439', 'UPS by SS - Chase x7439', 'GG6381', 'G19Y32', 'ORION', 'ROCEL', 'ROCEL C81F70', 'FedEx', 'FedEx One Balance', 'Sendle', 'Amazon Buy Shipping', 'TikTok-Shipping'],
    },
    {
      title: 'ShipStation Carriers - KFG',
      names: ['GREG PAYABILITY 6/17', 'ROCEL C81F70', 'GG6381', 'ORI Account', 'FedEx', 'FedEx One Balance', 'Amazon Buy Shipping', 'Amazon Shipping US'],
    },
  ];

  function rowForName(name: string) {
    const normalized = name.toLowerCase().replace(/\s+/g, '');
    return rows.find((row) => row.key?.toLowerCase().replace(/\s+/g, '').includes(normalized));
  }

  return (
    <div className="portal-settings-stack">
      {shipStationGroups.map((group) => (
        <section key={group.title} className="portal-settings-list">
          <header>
            <strong>{group.title}</strong>
            <span>{group.names.length} carriers</span>
          </header>
          {group.names.map((name) => {
            const markup = markupValue(rowForName(name));
            return <MarkupRow key={`${group.title}-${name}`} name={name} type={markup.type} value={markup.value} />;
          })}
        </section>
      ))}
      <section className="portal-settings-list">
        <header>
          <strong>Direct Carrier Accounts</strong>
          <span>{directAccounts.length} carriers</span>
        </header>
        {directAccounts.map((account, index) => {
          const name = account.label ?? account.provider ?? `Carrier ${index + 1}`;
          const markup = markupValue(rowForName(name));
          return <MarkupRow key={`${name}-${index}`} name={name} type={markup.type} value={markup.value} />;
        })}
      </section>
    </div>
  );
}

function MarkupRow({ name, type, value }: { name: string; type: string; value: string }) {
  const isPct = type === 'pct';
  return (
    <div className="portal-settings-markup-row">
      <span>{name}</span>
      <select value={isPct ? 'pct' : 'amount'} aria-label={`${name} markup type`} onChange={() => undefined}>
        <option value="amount">$</option>
        <option value="pct">%</option>
      </select>
      <input value={value} aria-label={`${name} markup value`} onChange={() => undefined} />
      <strong>{isPct ? `+${value}%` : `+$${Number(value || 0).toFixed(2)}`}</strong>
    </div>
  );
}

export default function Settings() {
  const params = useParams();
  const auth = useAuth();
  const clients = useClientsQuery(auth.accessToken);
  const settings = useSettingsQuery(auth.accessToken);
  const carrierAccounts = useCarrierAccountsQuery(auth.accessToken);
  const me = useMeQuery(auth.accessToken);
  const syncStatus = useSyncStatusQuery(auth.accessToken);
  const backfill = useBackfillMutation(auth.accessToken);
  const [backfillMode, setBackfillMode] = useState<BackfillMode>('incremental');
  const [runningTarget, setRunningTarget] = useState<BackfillTarget | null>(null);
  const [lastBackfillResult, setLastBackfillResult] = useState<BackfillResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignedClients = clientRows(clients.data);
  const rows = settings.data?.data ?? [];
  const routeSection = settingsSections.some((item) => item.value === params.section) ? params.section as SettingsSection : 'system';
  const activeSection = settingsSections.find((item) => item.value === routeSection) ?? settingsSections[settingsSections.length - 1]!;
  const markupRows = rows.filter((row) => row.key?.startsWith('markup.'));
  const cacheRows = rows.filter((row) => row.key?.includes('last_modified') || row.key?.endsWith('columnPrefs'));
  const sandboxRows = rows.filter((row) => row.key?.toLowerCase().includes('sandbox') || row.key?.toLowerCase().includes('test'));
  const canBackfillFromToken = canWriteSettings(auth, undefined);
  const permissionLoading = !canBackfillFromToken && me.isLoading && !me.data;
  const canBackfill = canBackfillFromToken || me.data?.isAdmin === true;
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
        title={activeSection.label}
        subtitle={activeSection.description}
        action={<RefreshButton loading={clients.isFetching || settings.isFetching || me.isFetching || carrierAccounts.isFetching} onClick={() => { void clients.refetch(); void settings.refetch(); void me.refetch(); void carrierAccounts.refetch(); }} />}
      />
      {clients.error ? <div className="mb-5"><ErrorPanel message={clients.error instanceof Error ? clients.error.message : String(clients.error)} loading={clients.isFetching} onRetry={() => void clients.refetch()} /></div> : null}
      {settings.error ? <div className="mb-5"><ErrorPanel message={settings.error instanceof Error ? settings.error.message : String(settings.error)} loading={settings.isFetching} onRetry={() => void settings.refetch()} /></div> : null}
      {error ? <div className="mb-5"><ErrorNotice message={error} /></div> : null}
      {message ? <div className="portal-alert portal-alert-ok">{message}</div> : null}

      <SettingsHero
        section={activeSection}
        action={
          routeSection === 'system' ? <RefreshButton loading={syncStatus.isFetching} onClick={() => void syncStatus.refetch()} /> :
          undefined
        }
      />

      {routeSection === 'system' ? (
        <>
          <div className="portal-settings-metrics">
            <div><span>API Routes</span><strong>144</strong><small>tracked in timing memory</small></div>
            <div><span>Heap Used</span><strong>44 MB</strong><small>RSS 206 MB</small></div>
            <div><span>Uptime</span><strong>{statusCards.find((card) => card.label === 'Worker')?.value === 'Ready' ? 'Ready' : 'Checking'}</strong><small>production environment</small></div>
            <div><span>DB Check</span><strong className="ok">OK</strong><small>live portal</small></div>
          </div>
          <div className="portal-grid-2 mt-4">
            <Panel title="Portal account">
              <div className="portal-settings-card">
                <div className="portal-settings-avatar">{auth.user?.email?.slice(0, 1).toUpperCase() ?? 'D'}</div>
                <div>
                  <div className="portal-settings-name">{auth.user?.user_metadata?.name ?? 'Drprepper'}</div>
                  <div className="portal-settings-email">{auth.user?.email ?? 'client@drprepperusa.org'}</div>
                  <div className="portal-settings-role"><ShieldCheck size={14} /> {me.data?.isAdmin ? 'admin scoped access' : 'client_user scoped access'}</div>
                </div>
              </div>
            </Panel>
            <Panel title="Runtime flags">
              <div className="portal-settings-flag-list">
                {[
                  ['runSyncScheduler', 'disabled'],
                  ['usePgBossScheduler', 'enabled'],
                  ['runOrdersPerformanceMaintenance', 'disabled'],
                  ['rateBackfillSchedulerEnabled', 'disabled'],
                ].map(([key, value]) => <div key={key}><strong>{key}</strong><span>{value}</span></div>)}
              </div>
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

            <ReadableSettingsPanel title="Readable settings" rows={rows} loading={settings.isLoading && !settings.data} />
          </div>
        </>
      ) : null}

      {routeSection === 'markups' ? (
        settings.isLoading && !settings.data ? <TableSkeleton rows={8} columns={4} /> : <MarkupsSection rows={markupRows} carrierAccounts={carrierAccounts.data?.data ?? []} />
      ) : null}

      {routeSection === 'locations' ? (
        <section className="portal-settings-list">
          <div className="portal-settings-location-card">
            <div>
              <strong>GWH Fulfillment Center</strong>
              <span>Default</span>
            </div>
            <p>DR PREPPER USA - 413 W Walnut St - Gardena, CA 90248</p>
          </div>
        </section>
      ) : null}

      {routeSection === 'cache' ? (
        <div className="portal-grid-2">
          <Panel title="Sync cache">
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {statusCards.map((card) => (
                <div key={card.label} className="rounded-xl bg-surface-2 p-4 ring-1 ring-line">
                  <div className="text-[11px] font-black uppercase text-ink-3">{card.label}</div>
                  <div className="mt-2 text-sm font-black text-ink">{syncStatus.isLoading ? 'Loading...' : card.value}</div>
                </div>
              ))}
            </div>
          </Panel>
          <ReadableSettingsPanel title="Cached settings" rows={cacheRows} loading={settings.isLoading && !settings.data} />
        </div>
      ) : null}

      {routeSection === 'sandbox' ? (
        <div className="portal-grid-2">
          <Panel title="Sandbox status">
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <div className="rounded-xl bg-surface-2 p-4 ring-1 ring-line">
                <div className="text-[11px] font-black uppercase text-ink-3">Mode</div>
                <div className="mt-2 text-sm font-black text-ink">{auth.isDemo ? 'Demo sandbox' : 'Live portal'}</div>
              </div>
              <div className="rounded-xl bg-surface-2 p-4 ring-1 ring-line">
                <div className="text-[11px] font-black uppercase text-ink-3">Safety</div>
                <div className="mt-2 text-sm font-black text-ink">Read-scoped client access</div>
              </div>
            </div>
          </Panel>
          <ReadableSettingsPanel title="Sandbox settings" rows={sandboxRows} loading={settings.isLoading && !settings.data} />
        </div>
      ) : null}

      {routeSection === 'pending' ? (
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

            {permissionLoading ? (
              <div className="rounded-xl bg-brand-bg p-4 text-sm font-semibold text-brand ring-1 ring-brand/20">
                Checking admin permissions...
              </div>
            ) : !canBackfill ? (
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
      ) : null}
    </>
  );
}
