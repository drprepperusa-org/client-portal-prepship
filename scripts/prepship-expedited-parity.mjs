// CP-060 — cross-repo classification gate.
//
// PrepShip owns the expedited-service classification. This repo pins it in
// contracts/prepship-reporting-expedited-services.json. That pin is only worth
// something if an upstream change can FAIL something here; a comment saying
// "if that list changes, this one must change" is a human reminder, not a gate
// (Hermes, CP-060, 2026-08-22).
//
// This script fetches the pinned path from prepship-v4 and fails when:
//   - the upstream blob SHA no longer matches the pin (upstream changed → re-pin), or
//   - the parsed upstream list differs from the pinned services, or
//   - the pinned services differ from what this repo actually classifies with.
//
// prepship-v4 is PRIVATE and this repo is PUBLIC, so the default Actions
// GITHUB_TOKEN cannot read it. Set PREPSHIP_CONTRACT_TOKEN (a PAT with read
// access to drprepperusa-org/prepship-v4) for the remote half to run. Without
// it the script reports NOT ARMED and exits non-zero unless --allow-unarmed is
// passed, so a missing token can never look like a passing gate.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const allowUnarmed = process.argv.includes('--allow-unarmed');
const contract = JSON.parse(
  readFileSync('contracts/prepship-reporting-expedited-services.json', 'utf8')
);
const { repo, ref, path: upstreamPath, export: exportName, blobSha } = contract.upstream;

let failed = false;
function fail(message) {
  console.error(`FAIL ${message}`);
  failed = true;
}
function pass(message) {
  console.log(`PASS ${message}`);
}

// ── local half: always runs ──────────────────────────────────────────────────
const shippingClass = readFileSync('src/lib/shipping-class.ts', 'utf8');
if (/EXPEDITED_SERVICES\s*=\s*\[/.test(shippingClass)) {
  fail('src/lib/shipping-class.ts re-declares the list instead of reading the contract');
} else {
  pass('shipping-class.ts reads the pinned contract rather than hand-copying the list');
}

const guard = readFileSync('scripts/client-portal-analysis-cp060-guard.mjs', 'utf8');
if (/CANONICAL_EXPEDITED\s*=\s*\[\s*\n\s*'/.test(guard)) {
  fail('the CP-060 guard still carries its own hardcoded copy of the list');
} else {
  pass('the CP-060 guard compares against the contract, not a third copy');
}

if (!Array.isArray(contract.services) || contract.services.length === 0) {
  fail('the contract lists no services');
} else {
  pass(`the contract pins ${contract.services.length} services from ${repo}@${blobSha.slice(0, 8)}`);
}

// ── remote half: needs a cross-repo token ────────────────────────────────────
const token = process.env.PREPSHIP_CONTRACT_TOKEN || '';
if (!token) {
  const message =
    'NOT ARMED — PREPSHIP_CONTRACT_TOKEN is not set, so upstream drift cannot be detected. ' +
    'Add a PAT with read access to ' + repo + ' as a repo secret to arm this gate.';
  if (allowUnarmed) {
    console.warn(`WARN ${message}`);
  } else {
    fail(message);
  }
} else {
  let remote;
  try {
    remote = JSON.parse(
      execFileSync(
        'gh',
        ['api', `repos/${repo}/contents/${upstreamPath}?ref=${ref}`],
        { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token } }
      )
    );
  } catch (error) {
    fail(`could not read ${repo}/${upstreamPath}@${ref}: ${String(error).split('\n')[0]}`);
    remote = null;
  }

  if (remote) {
    if (remote.sha !== blobSha) {
      fail(
        `upstream ${upstreamPath} has changed (pinned ${blobSha.slice(0, 8)}, upstream ` +
          `${String(remote.sha).slice(0, 8)}). Re-pin the contract and re-check the list.`
      );
    } else {
      pass(`upstream blob still matches the pin (${blobSha.slice(0, 8)})`);
    }

    const source = Buffer.from(remote.content, 'base64').toString('utf8');
    const block = source.match(
      new RegExp(`${exportName}\\s*=\\s*\\[([\\s\\S]*?)\\]`)
    );
    if (!block) {
      fail(`could not find ${exportName} in the upstream file`);
    } else {
      const upstreamServices = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const a = [...upstreamServices].sort().join(',');
      const b = [...contract.services].sort().join(',');
      if (a !== b) {
        fail(
          `upstream classification differs from the pinned contract.\n  upstream: ${a}\n  pinned:   ${b}`
        );
      } else {
        pass(`upstream ${exportName} matches the pinned contract exactly`);
      }
    }
  }
}

if (failed) {
  console.error('\n✖ prepship expedited-service parity gate failed.');
  process.exit(1);
}
console.log('\nPASS prepship expedited-service parity');
