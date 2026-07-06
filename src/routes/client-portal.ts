// Barrel router: this file was one flat ~1500-line Hono app. It is now a thin
// aggregator that mounts 12 per-domain sub-routers (src/routes/client-portal/*).
// Each sub-router is `const app = new Hono(); …; export default app`, using the
// same `app.route(prefix, sub)` idiom main.ts uses to mount THIS file. All
// sub-routers mount at '/', so their relative paths ('/orders',
// '/analysis/sku-orders', '/backfill', …) resolve to the identical
// /api/client-portal/* surface they had as one flat app. main.ts is unchanged:
// it still does `import clientPortalRoute from './routes/client-portal'` +
// `app.route('/api/client-portal', clientPortalRoute)`. Request context (auth /
// scope from requireAuth on the parent app) propagates through the nested mount.
import { Hono } from 'hono';
import dashboardRoute from './client-portal/dashboard';
import ordersRoute from './client-portal/orders';
import shipmentsRoute from './client-portal/shipments';
import inventoryRoute from './client-portal/inventory';
import analysisRoute from './client-portal/analysis';
import billingRoute from './client-portal/billing';
import invoicesRoute from './client-portal/invoices';
import accessRoute from './client-portal/access';
import integrationsRoute from './client-portal/integrations';
import inboundRoute from './client-portal/inbound';
import returnsRoute from './client-portal/returns';
import syncRoute from './client-portal/sync';
import auditLogRoute from './client-portal/audit-log';

const app = new Hono();

app.route('/', dashboardRoute);
app.route('/', ordersRoute);
app.route('/', shipmentsRoute);
app.route('/', inventoryRoute);
app.route('/', analysisRoute);
app.route('/', billingRoute);
app.route('/', invoicesRoute);
app.route('/', accessRoute);
app.route('/', integrationsRoute);
app.route('/', inboundRoute);
app.route('/', returnsRoute);
app.route('/', syncRoute);
app.route('/', auditLogRoute);

export default app;
