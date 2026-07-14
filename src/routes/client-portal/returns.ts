// Client-portal returns sub-router. Registration order matches the original route file.
import { Hono } from 'hono';
import { registerReturnActionRoutes } from './returns/actions';
import { registerReturnReadRoutes } from './returns/reads';
import { registerReturnReceivingRoutes } from './returns/receiving';

const app = new Hono();

registerReturnReadRoutes(app);
registerReturnActionRoutes(app);
registerReturnReceivingRoutes(app);

export default app;
