// Standard-vs-expedited service classification for the Client Portal.
//
// PrepShip OWNS this classification (prepship-v4
// src/services/reporting-projection.ts → REPORTING_EXPEDITED_SERVICES, PS-418).
// The Client Portal consumes it; it does not decide it.
//
// The list is no longer written out here. It is read from
// contracts/prepship-reporting-expedited-services.json, which carries the
// upstream repo, path, export name and the exact blob/commit SHA it was pinned
// from. That removes the hand-copy this file used to be — and, with the CP-060
// guard now comparing against the same artifact instead of carrying its own
// copy, removes the third copy too.
//
// Changing classification behaviour means RE-PINNING from upstream, not editing
// the JSON's `services` array. scripts/prepship-expedited-parity.mjs fetches the
// pinned path from prepship-v4 and fails when the pinned blob no longer matches,
// so an upstream change cannot pass silently (Hermes CP-060, 2026-08-22).
//
// v2-parity note, retained: v4 previously used a broad regex
// `(priority|express|overnight|expedited|...)` which over-matched
// `usps_priority_mail` as expedited. Only `usps_priority_mail_express` is
// expedited; USPS priority is standard. The regex was inflating AnalysisView
// "expedited" counts for every USPS priority shipment.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

type ExpeditedServicesContract = {
  upstream: {
    repo: string;
    ref: string;
    path: string;
    export: string;
    blobSha: string;
    commitSha: string;
  };
  services: string[];
};

export const EXPEDITED_SERVICES_CONTRACT_PATH = join(
  process.cwd(),
  'contracts',
  'prepship-reporting-expedited-services.json'
);

function loadContract(): ExpeditedServicesContract {
  const parsed = JSON.parse(
    readFileSync(EXPEDITED_SERVICES_CONTRACT_PATH, 'utf8')
  ) as ExpeditedServicesContract;
  if (!Array.isArray(parsed.services) || parsed.services.length === 0) {
    throw new Error(
      'prepship-reporting-expedited-services.json has no services — refusing to classify every shipment as standard'
    );
  }
  return parsed;
}

const contract = loadContract();

/** The PrepShip-owned expedited service codes, as pinned in the contract. */
export const EXPEDITED_SERVICES: readonly string[] = Object.freeze([...contract.services]);

/** Provenance of the pinned list, for guards and diagnostics. */
export const EXPEDITED_SERVICES_UPSTREAM = Object.freeze({ ...contract.upstream });

export const EXPEDITED_SERVICES_SQL = sql`ARRAY[${sql.join(
  EXPEDITED_SERVICES.map((s) => sql`${s}`),
  sql`, `
)}]::text[]`;
