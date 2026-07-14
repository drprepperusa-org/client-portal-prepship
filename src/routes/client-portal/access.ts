// Client-portal sub-router. Registration order matches the original route file.
import { Hono } from 'hono';
import { registerAccessInvitationRoutes } from './access/invitations';
import { registerAccessReadRoutes, registerAccessSettingsRoute } from './access/reads';
import { registerAccessUserMutationRoutes } from './access/users';

const app = new Hono();

registerAccessReadRoutes(app);
registerAccessInvitationRoutes(app);
registerAccessUserMutationRoutes(app);
registerAccessSettingsRoute(app);

export default app;
