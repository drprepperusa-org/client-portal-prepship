import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// Client Portal audit-log guard.
//
// The admin audit log must persist portal access/click events server-side and
// expose them through an admin-only Client Portal page. This keeps the feature
// from silently becoming console-only or UI-only.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const schemaExists = exists('src/db/schema/client-portal-audit-logs.ts');
const migrationExists = exists('drizzle/0036_client_portal_audit_logs.sql');
const routeExists = exists('src/routes/client-portal/audit-log.ts');
const pageExists = exists('portal-client/src/pages/AuditLog.tsx');

const schema = schemaExists ? read('src/db/schema/client-portal-audit-logs.ts') : '';
const migration = migrationExists ? read('drizzle/0036_client_portal_audit_logs.sql') : '';
const migrationLower = migration.toLowerCase();
const schemaIndex = read('src/db/schema/index.ts');
const drizzleConfig = read('drizzle.config.ts');
const audit = read('src/lib/client-portal/audit.ts');
const route = routeExists ? read('src/routes/client-portal/audit-log.ts') : '';
const routeFlat = flat(route);
const router = read('src/routes/client-portal.ts');
const main = read('src/main.ts');
const corsHelper = read('src/lib/http/cors.ts');
const scope = read('src/lib/client-portal/scope.ts');
const api = readActiveClientPortalApiSource();
const hooks = read('portal-client/src/lib/hooks.ts');
const nav = read('portal-client/src/nav.ts');
const app = read('portal-client/src/App.tsx');
const prefetch = read('portal-client/src/lib/routePrefetch.ts');
const sidebar = read('portal-client/src/components/layout/Sidebar.tsx');
const page = pageExists ? read('portal-client/src/pages/AuditLog.tsx') : '';
const pkg = JSON.parse(read('package.json'));

assert(schemaExists, 'audit-log schema file exists');
assert(
  schema.includes("'client_portal_audit_logs'") &&
    schema.includes('clientPortalAuditLogs') &&
    schema.includes('actorUserId') &&
    schema.includes('actorEmail') &&
    schema.includes('clientIds') &&
    schema.includes('storeIds') &&
    schema.includes('metadata') &&
    schema.includes('createdAt'),
  'schema defines persisted audit log columns',
);
assert(
  schema.includes('client_portal_audit_logs_created_at_idx') &&
    schema.includes('client_portal_audit_logs_actor_email_idx') &&
    schema.includes('client_portal_audit_logs_event_idx'),
  'schema indexes audit lookup fields',
);
assert(
  migrationExists &&
    migrationLower.includes('create table if not exists client_portal_audit_logs') &&
    migrationLower.includes('actor_user_id') &&
    migrationLower.includes('actor_email') &&
    migrationLower.includes('client_ids integer[]') &&
    migrationLower.includes('metadata jsonb') &&
    migrationLower.includes('created_at timestamptz'),
  'migration creates client_portal_audit_logs table',
);
assert(
  migration.includes('client_portal_audit_logs_created_at_idx') &&
    migration.includes('client_portal_audit_logs_actor_email_idx') &&
    migration.includes('client_portal_audit_logs_event_idx'),
  'migration creates audit-log indexes',
);
assert(
  schemaIndex.includes("export * from './client-portal-audit-logs'"),
  'schema index exports audit-log table',
);
assert(
  drizzleConfig.includes("./src/db/schema/client-portal-audit-logs.ts"),
  'drizzle config includes audit-log schema for future migrations',
);
assert(
  audit.includes("from '../../db/client'") &&
    audit.includes("from '../../db/schema/client-portal-audit-logs'") &&
    audit.includes('db.insert(clientPortalAuditLogs)') &&
    audit.includes('sanitizePortalAuditMetadata') &&
    audit.includes("console.warn('[client-portal:audit] persist failed'") &&
    audit.includes('recordCriticalPortalAudit') &&
    audit.includes("console.warn('[client-portal:audit] critical persist failed'"),
  'audit helper persists sanitized events and supports fail-closed critical writes',
);
assert(
  !scope.includes('auditSource') &&
    !scope.toLowerCase().includes('x-portal-audit-source') &&
    !audit.includes("scope.auditSource === 'background'"),
  'public request scope cannot suppress audit persistence',
);
assert(
  !main.includes('X-Portal-Audit-Source') &&
    !corsHelper.includes('X-Portal-Audit-Source'),
  'CORS does not allow a client-controlled audit source header',
);
assert(routeExists, 'audit-log route file exists');
assert(
  routeFlat.includes("app.get('/audit-log'") &&
    routeFlat.includes("app.post('/audit-log/click'") &&
    routeFlat.includes('clientPortalCapabilities(scope).canViewAudit') &&
    routeFlat.includes('clientPortalAuditLogs') &&
    routeFlat.includes('scopeLabel: buildScopeLabel') &&
    route.includes('loadAuditScopeNames') &&
    routeFlat.includes("portal.ui.click") &&
    routeFlat.includes('desc(clientPortalAuditLogs.createdAt'),
  'audit-log route exposes admin list and authenticated click tracking',
);
assert(
  !route.includes("recordPortalAudit('portal.audit_log.view") &&
    route.includes("ne(clientPortalAuditLogs.event, 'portal.audit_log.view')"),
  'audit-log list does not log or show its own read events',
);
assert(
  router.includes("import auditLogRoute from './client-portal/audit-log'") &&
    router.includes("app.route('/', auditLogRoute)"),
  'client-portal router mounts audit-log route',
);
assert(
  api.includes('export interface PortalAuditLogRow') &&
  api.includes('clientNames: string[]') &&
    api.includes('storeNames: string[]') &&
    api.includes('scopeLabel: string') &&
    api.includes('canManageUsers: boolean') &&
    api.includes('canManageAdmins: boolean') &&
    api.includes('canViewAudit: boolean') &&
    !api.includes('X-Portal-Audit-Source') &&
    !api.includes('backgroundRequest') &&
    api.includes('auditLog: (token: string') &&
    api.includes("'/api/client-portal/audit-log'") &&
    api.includes('auditClick: (token: string'),
  'portal API exposes audit-log scope fields and backend-owned capabilities without spoofable audit tagging',
);
assert(
  hooks.includes('export function useAuditLog') &&
    hooks.includes('portalApi.auditLog') &&
    hooks.includes("['audit-log'") &&
    !hooks.includes('backgroundRequest') &&
    hooks.includes('portalApi.backgroundDashboard') &&
    hooks.includes('portalApi.backgroundOrders') &&
    hooks.includes('portalApi.backgroundInventory'),
  'frontend hook fetches audit log',
);
assert(
  nav.includes("label: 'Audit log'") &&
    nav.includes("to: '/audit-log'"),
  'sidebar nav declares Audit log item',
);
assert(
  app.includes("const AuditLog = lazy(() => import('./pages/AuditLog'))") &&
    app.includes('path="/audit-log"') &&
    app.includes('<RequireCapability capability="canViewAudit">'),
  'App routes Audit log through backend-owned canViewAudit capability',
);
assert(
  prefetch.includes("'/audit-log': () => import('@/pages/AuditLog')"),
  'route prefetch warms Audit log chunk',
);
assert(
  sidebar.includes('portalApi.auditClick') &&
    sidebar.includes("target: item.label") &&
    sidebar.includes("target: 'Sign out'") &&
    sidebar.includes('me.data?.canManageUsers') &&
    sidebar.includes('me.data?.canViewAudit'),
  'sidebar logs nav/sign-out clicks and uses backend capabilities for protected navigation',
);
assert(pageExists, 'AuditLog page exists');
assert(
  page.includes('Audit log') &&
    page.includes('useAuditLog') &&
    page.includes('return row.scopeLabel') &&
    !page.includes("Stores ${row.storeIds.join(', ')}") &&
    page.includes('Session scope') &&
    !page.includes('Client scope') &&
    page.includes('Search event or user') &&
    page.includes('Event') &&
    page.includes('User') &&
    page.includes('When') &&
    page.includes('Details'),
  'AuditLog page renders searchable operational log columns',
);
assert(
  pkg.scripts?.['test:client-portal-audit-log'] === 'node scripts/client-portal-audit-log-guard.mjs',
  'package exposes test:client-portal-audit-log',
);

if (failed) process.exit(1);
console.log('\nclient portal audit-log guard passed.');
