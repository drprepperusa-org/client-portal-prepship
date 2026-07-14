// Client-portal integrations sub-router. Registration order matches the original route file.
import { Hono } from 'hono';
import { registerIntegrationMutationRoutes } from './integrations/mutations';
import { registerIntegrationReadRoutes } from './integrations/reads';
import { registerIntegrationSubmissionRoute } from './integrations/submission';

const app = new Hono();

registerIntegrationReadRoutes(app);
registerIntegrationSubmissionRoute(app);
registerIntegrationMutationRoutes(app);

export default app;
