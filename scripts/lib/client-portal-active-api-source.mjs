import fs from 'node:fs';
import path from 'node:path';

const contractFiles = [
  'common.ts',
  'orders.ts',
  'shipments.ts',
  'returns.ts',
  'inventory.ts',
  'connections.ts',
  'dashboard.ts',
  'access.ts',
  'billing.ts',
  'analysis.ts',
  'inbound.ts',
  'index.ts',
];

const frontendFiles = [
  'portal-client/src/lib/api.ts',
  'portal-client/src/lib/api/transport.ts',
  'portal-client/src/lib/api/scope.ts',
  'portal-client/src/lib/api/client.ts',
  'portal-client/src/lib/api/domains/access.ts',
  'portal-client/src/lib/api/domains/dashboard.ts',
  'portal-client/src/lib/api/domains/orders.ts',
  'portal-client/src/lib/api/domains/shipments.ts',
  'portal-client/src/lib/api/domains/inventory.ts',
  'portal-client/src/lib/api/domains/returns.ts',
  'portal-client/src/lib/api/domains/connections.ts',
  'portal-client/src/lib/api/domains/inbound.ts',
  'portal-client/src/lib/api/domains/analysis.ts',
  'portal-client/src/lib/api/domains/billing.ts',
];

export const activeClientPortalApiFiles = [
  ...contractFiles.map((file) => `src/lib/client-portal/contracts/${file}`),
  ...frontendFiles,
];

export function readActiveClientPortalApiSource(root = process.cwd()) {
  return activeClientPortalApiFiles
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
    .join('\n');
}
