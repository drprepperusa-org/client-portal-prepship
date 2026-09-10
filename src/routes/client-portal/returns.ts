// Client-portal returns sub-router. Registration order matches the original route file.
import { Hono } from 'hono';
import { registerReturnActionRoutes } from './returns/actions';
import { registerReturnReadRoutes } from './returns/reads';
import { registerReturnReceivingRoutes } from './returns/receiving';
import { registerReturnTrackingRefreshRoute } from './returns/tracking';

const app = new Hono();

registerReturnReadRoutes(app);
registerReturnActionRoutes(app);
registerReturnReceivingRoutes(app);
// CP-069: returns-scoped carrier refresh (the outbound Shipments page no longer drives it).
registerReturnTrackingRefreshRoute(app);

export default app;
