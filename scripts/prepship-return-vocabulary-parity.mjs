// CP-059 — cross-repo RETURN line-type vocabulary gate.
//
// PrepShip owns which line types are return money, and how they split into the postage and
// processing buckets. This repo's two summary authorities sum by that vocabulary, so a spelling
// present upstream and missing here drops return money out of the return bucket while leaving it
// inside grand_total. Upstream's own doc comment names that failure mode; review found this repo
// living it, with a canonical return total of $0.00 for the producer's legacy bare-return shape.
//
// A comment saying "keep these in sync" is a human reminder, not a gate. This script fetches the
// pinned upstream file and fails when:
//   - the upstream blob SHA no longer matches the pin (upstream changed -> re-pin), or
//   - the upstream vocabulary differs from the pinned contract, or
//   - the pinned contract differs from what this repo actually sums with.
//
// prepship-v4 is PRIVATE and this repo is PUBLIC, so the default Actions GITHUB_TOKEN cannot
// read it. Set PREPSHIP_CONTRACT_TOKEN (a PAT with read access to drprepperusa-org/prepship-v4)
// for the remote half to run. Without it the script reports NOT ARMED and exits non-zero unless
// --allow-unarmed is passed, so a missing token can never look like a passing gate.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const allowUnarmed = process.argv.includes('--allow-unarmed');
const contract = JSON.parse(
  readFileSync('contracts/prepship-billing-return-line-types.json', 'utf8'),
);
const { repo, ref, path: upstreamPath, blobSha, exports: upstreamExports } = contract.upstream;

let failed = false;
const fail = (message) => { console.error(`FAIL ${message}`); failed = true; };
const pass = (message) => { console.log(`PASS ${message}`); };
const sorted = (list) => [...list].map((s) => s.toLowerCase()).sort().join(',');

// ── local half: always runs ──────────────────────────────────────────────────
const local = readFileSync('src/services/billing-line-types.ts', 'utf8');
const listFrom = (name) => {
  const block = local.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  return block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : null;
};
const localPostage = listFrom('RETURN_POSTAGE_LINE_TYPES');
const localProcessing = listFrom('RETURN_PROCESSING_LINE_TYPES');
const localBare = listFrom('RETURN_BARE_LINE_TYPES');

if (!localPostage || !localProcessing || !localBare) {
  fail('could not read the three return line-type lists from src/services/billing-line-types.ts');
} else {
  const localAll = [...localPostage, ...localProcessing, ...localBare];
  for (const [label, mine, pinned] of [
    ['postage', localPostage, contract.postage],
    ['processing', localProcessing, contract.processing],
    ['bare', localBare, contract.bare],
    ['all', localAll, contract.all],
  ]) {
    if (sorted(mine) !== sorted(pinned)) {
      fail(
        `this repo's ${label} return line types differ from the pinned contract.\n` +
          `  local:  ${sorted(mine)}\n  pinned: ${sorted(pinned)}`,
      );
    } else {
      pass(`local ${label} return line types match the pinned contract`);
    }
  }
}

// CLASSIFICATION AND VALIDATION MUST NORMALISE IDENTICALLY.
//
// Review found the aggregates written as `lower(b.line_type) in (...)` while the customer-safety
// gate compared RAW text against the same lowercase list. line_type is a bare `text not null`
// with no lowercase constraint, so a row spelled RETURN_LABEL was classified as return postage
// AND slipped past postage validation — unvalidated money on a customer's invoice, through
// capitalisation alone.
//
// Rendered, not grepped: both fragments are compiled to SQL and compared, so this cannot be
// satisfied by a comment or by a spelling that merely looks right.
{
  let rendered = null;
  try {
    const out = execFileSync('npx', ['tsx', 'scripts/cp-059-render-return-sql.ts'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    rendered = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } catch (error) {
    fail(`could not render the return-postage SQL to compare normalisation: ${String(error).split('\n')[0]}`);
  }
  if (rendered) {
    const normalises = (fragment) => /lower\(/.test(fragment);
    if (!normalises(rendered.classification)) {
      fail('the return-postage CLASSIFICATION no longer lowercases the line type');
    } else if (!normalises(rendered.gate)) {
      fail(
        'the customer-safety GATE does not lowercase the line type while classification does — ' +
          'a RETURN_LABEL row would be counted as postage and skip postage validation',
      );
    } else {
      pass('classification and the customer-safety gate normalise case identically');
    }
    // The gate must be the NEGATION of the same predicate, not a second hand-written list.
    if (rendered.gate.includes(rendered.classification.trim())) {
      pass('the safety gate is the shared classification predicate, not a second copy');
    } else {
      fail('the safety gate no longer reuses the shared classification predicate');
    }
  }
}

// Both summary authorities must SUM by the registry, not by a hand-listed spelling. A literal
// 'return_postage' in a case arm is how the vocabulary drifted in the first place.
for (const file of ['src/services/billing-summaries.ts', 'src/services/reporting-metrics.ts']) {
  const source = readFileSync(file, 'utf8');
  const handListed = source.match(/line_type\s*=\s*'return[a-z_]*'|lower\(b\.line_type\) in \(/g);
  if (handListed) {
    fail(`${file} still hand-lists a return line type in SQL: ${[...new Set(handListed)].join(', ')}`);
  } else {
    pass(`${file} sums return money through the shared registry, not a hand-listed spelling`);
  }
}

// ── remote half: needs a cross-repo token ────────────────────────────────────
const token = process.env.PREPSHIP_CONTRACT_TOKEN || '';
if (!token) {
  const message =
    `NOT ARMED — PREPSHIP_CONTRACT_TOKEN is not set, so upstream drift cannot be detected. ` +
    `Add a PAT with read access to ${repo} as a repo secret to arm this gate.`;
  if (allowUnarmed) console.warn(`WARN ${message}`);
  else fail(message);
} else {
  let remote = null;
  try {
    remote = JSON.parse(
      execFileSync('gh', ['api', `repos/${repo}/contents/${upstreamPath}?ref=${ref}`], {
        encoding: 'utf8',
        env: { ...process.env, GH_TOKEN: token },
      }),
    );
  } catch (error) {
    fail(`could not read ${repo}/${upstreamPath}@${ref}: ${String(error).split('\n')[0]}`);
  }

  if (remote) {
    if (remote.sha !== blobSha) {
      fail(
        `upstream ${upstreamPath} has changed (pinned ${blobSha.slice(0, 8)}, upstream ` +
          `${String(remote.sha).slice(0, 8)}). Re-pin the contract and re-check the vocabulary.`,
      );
    } else {
      pass(`upstream blob still matches the pin (${blobSha.slice(0, 8)})`);
    }

    const source = Buffer.from(remote.content, 'base64').toString('utf8');

    const allBlock = source.match(
      new RegExp(`${upstreamExports.all}\\s*=\\s*\\[([\\s\\S]*?)\\]`),
    );
    if (!allBlock) {
      fail(`could not find ${upstreamExports.all} in the upstream file`);
    } else {
      const upstreamAll = [...allBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      if (sorted(upstreamAll) !== sorted(contract.all)) {
        fail(
          `upstream return vocabulary differs from the pinned contract.\n` +
            `  upstream: ${sorted(upstreamAll)}\n  pinned:   ${sorted(contract.all)}`,
        );
      } else {
        pass(`upstream ${upstreamExports.all} matches the pinned contract exactly`);
      }
    }

    // The SPLIT matters as much as the membership: filing return_label under processing would
    // keep the canonical total right while making both named parts wrong.
    for (const [label, exportName, pinned] of [
      ['postage', upstreamExports.postage, contract.postage],
      ['processing', upstreamExports.processing, contract.processing],
    ]) {
      const fnBlock = source.match(
        new RegExp(`function ${exportName}\\([\\s\\S]*?\\n\\}`),
      );
      if (!fnBlock) {
        fail(`could not find ${exportName} in the upstream file`);
        continue;
      }
      const upstreamBucket = [...fnBlock[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      if (sorted(upstreamBucket) !== sorted(pinned)) {
        fail(
          `upstream ${label} bucket differs from the pinned contract.\n` +
            `  upstream: ${sorted(upstreamBucket)}\n  pinned:   ${sorted(pinned)}`,
        );
      } else {
        pass(`upstream ${exportName} matches the pinned ${label} bucket exactly`);
      }
    }
  }
}

// ── the canonicalEventId mitigation must retire itself ──────────────────────
//
// CP-059 was deployed AHEAD of its producer, against the card's own stated order. The deployed
// PrepShip did not emit canonicalEventId, the portal required it, and because one bad row fails
// the whole response, Billing line items returned 502 for every client for ~12 hours
// (2026-08-30). The portal now substitutes a positional identity when the field is WHOLLY
// ABSENT — a deliberate, temporary loosening.
//
// Nothing in the static suite noticed that loosening, so nothing would stop it becoming
// permanent. This check is the counterweight, and it cuts BOTH ways:
//
//   deployed producer emits canonicalEventId  -> the mitigation must be GONE
//   deployed producer does not emit it        -> the mitigation must be PRESENT
//
// It reads the branch Render actually deploys rather than a pinned commit, because the whole
// failure was the difference between what we pinned and what was running.
{
  const proxy = readFileSync('src/lib/client-portal/prepship-billing-details-proxy.ts', 'utf8');
  const mitigationPresent = /LEGACY_EVENT_ID_PREFIX/.test(proxy);

  if (!token) {
    // Unarmed already fails above; say plainly that this check could not run either.
    console.warn('WARN  the canonicalEventId mitigation check needs the token too — not verified');
  } else {
    const deployedRef = 'prepshipv4-stable';
    const producerPath = 'src/services/billing-detail-row-sot.ts';
    let producer = null;
    try {
      const meta = JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/contents/${producerPath}?ref=${deployedRef}`], {
          encoding: 'utf8',
          env: { ...process.env, GH_TOKEN: token },
        }),
      );
      producer = Buffer.from(meta.content, 'base64').toString('utf8');
    } catch {
      // The file not existing on that branch is itself the "does not emit it" case.
      producer = '';
    }
    const producerEmitsIdentity = /canonicalEventId/.test(producer);

    if (producerEmitsIdentity && mitigationPresent) {
      fail(
        `the deployed producer (${repo}@${deployedRef}) now emits canonicalEventId, so the `
        + 'temporary positional-identity mitigation in prepship-billing-details-proxy.ts must be '
        + 'REMOVED and the identity required again. Leaving it in place keeps a weaker contract '
        + 'than the producer now guarantees.',
      );
    } else if (!producerEmitsIdentity && !mitigationPresent) {
      fail(
        `the deployed producer (${repo}@${deployedRef}) does NOT emit canonicalEventId, so `
        + 'requiring it fails row 0 of every response and returns 502 for all Billing line '
        + 'items. Restore the mitigation, or ship the producer first.',
      );
    } else if (producerEmitsIdentity) {
      pass('the deployed producer emits canonicalEventId and the mitigation is retired');
    } else {
      pass(
        'the deployed producer does not emit canonicalEventId; the positional-identity '
        + 'mitigation is correctly still in place',
      );
    }
  }
}

if (failed) {
  console.error('\n✖ prepship return-vocabulary parity gate failed.');
  process.exit(1);
}
console.log('\nPASS prepship return-vocabulary parity');
