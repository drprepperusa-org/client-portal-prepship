import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const secretKeys = ['ssApiKey', 'ssApiSecret', 'ssApiKeyV2'];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function assert(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

const publicClient = read('src/lib/public-client.ts');
const clientsRoute = read('src/routes/clients.ts');
const initRoute = read('src/routes/init.ts');
// Active portal surfaces (the legacy web/ ClientModal/v2Hooks/v2-apiClient files
// this guard used to read were removed with the legacy app).
const portalApi = read('portal-client/src/lib/api.ts');
const portalHooks = read('portal-client/src/lib/hooks.ts');

assert(
  /const\s*\{\s*ssApiKey,\s*ssApiSecret,\s*ssApiKeyV2,\s*\.\.\.safe\s*\}\s*=\s*row/.test(
    publicClient,
  ),
  'publicClient strips ShipStation secret fields',
);
assert(
  publicClient.includes('hasShipStationV1Credentials') &&
    publicClient.includes('hasShipStationV2Credentials'),
  'publicClient emits credential presence booleans',
);

assert(
  clientsRoute.includes("import { publicClient } from '../lib/public-client'"),
  'clients route imports publicClient mapper',
);
assert(
  (clientsRoute.match(/publicClient/g) ?? []).length >= 5,
  'clients route uses publicClient on list, detail, create, and update responses',
);
assert(
  !/return\s+c\.json\(\s*(rows|row)\s*[,)]/.test(clientsRoute),
  'clients route does not return raw client rows',
);
assert(
  /clients:\s*clientsRows\.map\(publicClient\)/.test(initRoute) ||
    /visibleClients\s*=\s*filterClientsForScope\(\s*clientsRows\.map\(publicClient\)/.test(initRoute),
  'init-data maps client rows through publicClient',
);
assert(
  !/clients:\s*clientsRows\s*[,}]/.test(initRoute),
  'init-data does not return raw clientsRows',
);

const lightweightMatch = clientsRoute.match(
  /function\s+lightweightClient[\s\S]*?\n}\n\nconst\s+body/,
);
assert(Boolean(lightweightMatch), 'lightweight client serializer is present');
if (lightweightMatch) {
  for (const key of secretKeys) {
    assert(
      !lightweightMatch[0].includes(key),
      `lightweight client serializer does not expose ${key}`,
    );
  }
}

// The active client portal must never reference raw ShipStation secret fields —
// credential presence, when needed, comes from the backend's presence booleans.
for (const [label, source] of [
  ['portal-client api.ts', portalApi],
  ['portal-client hooks.ts', portalHooks],
]) {
  for (const key of [...secretKeys, 'ss_api_key', 'ss_api_secret']) {
    assert(!source.includes(key), `${label} does not reference ${key}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
