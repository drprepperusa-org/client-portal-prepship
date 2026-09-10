// CP-069 — cross-repo ORDER-LIFECYCLE display gate.
//
// PrepShip owns how an order becomes 'shipped' / 'cancelled' / awaiting (the effective-status
// CASE in src/services/order-lifecycle-status.ts), how a SHIPPED order's label truth is
// classified (resolveShippedLabelDisplayState) and which shipment rows are outbound evidence
// (shipment-aggregate.ts). The Client Portal carries a pinned port of all three in
// src/lib/client-portal/order-lifecycle.ts. PS 0057 builds orders_effective_status_date_id_idx
// on the byte-identical CASE text, so the port must stay byte-identical for the shared production
// database to keep using that index — and a customer 'Shipped' must never come from a second
// formula.
//
// A comment saying "verbatim port" is a human reminder, not a gate. This script fails when:
//   LOCAL (always)
//   - the portal's SOURCE templates differ from the pinned upstream templates,
//   - the portal's RENDERED SQL (PgDialect, via scripts/cp-069-render-lifecycle-sql.ts) differs
//     from the pinned CASE, or the Orders tab predicates stop rendering on that inner CASE,
//   - the ported display precedence, the outbound admission or the order-grain match arms drift.
//   REMOTE (PREPSHIP_CONTRACT_TOKEN)
//   - any of the three upstream blob SHAs no longer matches the pin at the pinned ref, or
//   - the UPSTREAM CASE text / display precedence / aggregate predicate differs from the pin
//     (rendered text, not only the SHA: the return-vocabulary gate's history is the argument).
//
// prepship-v4 is PRIVATE and this repo is PUBLIC, so the default Actions GITHUB_TOKEN cannot
// read it. Set PREPSHIP_CONTRACT_TOKEN (a PAT with read access to drprepperusa-org/prepship-v4)
// for the remote half to run. Without it the script reports NOT ARMED and exits non-zero unless
// --allow-unarmed is passed, so a missing token can never look like a passing gate.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const allowUnarmed = process.argv.includes('--allow-unarmed');
const contract = JSON.parse(readFileSync('contracts/prepship-order-lifecycle-display.json', 'utf8'));
const { repo, ref, files: upstreamFiles } = contract.upstream;

let failed = false;
const fail = (message) => { console.error(`FAIL ${message}`); failed = true; };
const pass = (message) => { console.log(`PASS ${message}`); };
const readLocal = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const ws = (text) => String(text).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

/**
 * The contract's documented normalisation: whitespace-collapse, then reduce every column
 * reference — PrepShip's `${orders.orderStatus}` / `${orderStatus}` template spellings, drizzle's
 * rendered `"orders"."order_status"`, and an alias-qualified `o.order_status` — to the bare
 * column name, so a SOURCE template and RENDERED SQL can be compared as one text.
 */
const normaliseSql = (text) =>
  ws(text)
    .replace(/\$\{orders\.orderStatus\}/g, 'order_status')
    .replace(/\$\{orders\.canonicalStatus\}/g, 'canonical_status')
    .replace(/\$\{orders\.externallyShipped\}/g, 'externally_shipped')
    .replace(/\$\{orderStatus\}/g, 'order_status')
    .replace(/\$\{canonicalStatus\}/g, 'canonical_status')
    .replace(/\$\{externallyShipped\}/g, 'externally_shipped')
    .replace(/"orders"\."(order_status|canonical_status|externally_shipped)"/g, '$1')
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*\.(order_status|canonical_status|externally_shipped)\b/g, '$1');

/** The `sql<string>\`...\`` template body of an exported function, or null. */
const templateOf = (source, fnName) => {
  const block = source.match(
    new RegExp(`export function ${fnName}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!block) return null;
  const template = block[1].match(/return sql<string>`([\s\S]*?)`;/);
  return template ? template[1] : null;
};

/** The body of an exported function up to its closing brace at column 0, or null. */
const functionBodyOf = (source, fnName) => {
  const block = source.match(new RegExp(`export function ${fnName}\\([\\s\\S]*?\\n\\}`));
  return block ? block[0] : null;
};

/** The executable statements of resolveShippedLabelDisplayState, comments stripped. */
const displayStateStatements = (source) => {
  const body = functionBodyOf(source, 'resolveShippedLabelDisplayState');
  if (!body) return null;
  return body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^(if \(|return )/.test(line))
    .map(ws);
};

const pinnedCanonical = ws(contract.effectiveStatusCase.canonical);
const pinnedBody = contract.shippedLabelDisplayState.body.map(ws);

// ── contract self-consistency ─────────────────────────────────────────────────
{
  const sourceReduces = normaliseSql(contract.effectiveStatusCase.source) === pinnedCanonical;
  const aliasReduces = normaliseSql(contract.effectiveStatusCase.aliasSource) === pinnedCanonical;
  if (sourceReduces && aliasReduces) {
    pass('pinned table and alias templates both reduce to the pinned canonical CASE');
  } else {
    fail('the pinned templates do not reduce to the pinned canonical CASE — the contract is inconsistent');
  }
  const PS_STATUSES = [
    'awaiting', 'shipped', 'cancelled', 'upstream_cancelled', 'externally_shipped',
    'shipped_pending_confirmation', 'confirmation_failed', 'voided_label',
    'missing_shipment_sync', 'on_hold', 'awaiting_payment', 'pending_fulfillment',
  ];
  const projection = contract.projection;
  const missing = PS_STATUSES.filter((status) => !(status in projection));
  const extra = Object.keys(projection).filter((key) => key !== 'note' && !PS_STATUSES.includes(key));
  const badTargets = Object.entries(projection)
    .filter(([key, value]) => key !== 'note' && !contract.portalStatuses.includes(value));
  if (missing.length === 0 && extra.length === 0 && badTargets.length === 0) {
    pass('the projection table covers exactly the 12 PrepShip lifecycle statuses onto the 4 portal statuses');
  } else {
    fail(
      `projection table drift — missing: [${missing}], unexpected: [${extra}], ` +
        `bad targets: [${badTargets.map(([k, v]) => `${k}->${v}`)}]`,
    );
  }
}

// ── local half: always runs ───────────────────────────────────────────────────
const ownerPath = contract.portal.owner;
const owner = readLocal(ownerPath);

// 1. SOURCE-level parity: the portal spells the two CASE templates exactly as PrepShip does.
for (const [label, fnName, pinned] of [
  ['table-form', contract.portal.exports.effective, contract.effectiveStatusCase.source],
  ['alias-form', contract.portal.exports.alias, contract.effectiveStatusCase.aliasSource],
]) {
  const template = templateOf(owner, fnName);
  if (!template) {
    fail(`could not read the sql template of ${fnName}() from ${ownerPath}`);
  } else if (ws(template) !== ws(pinned)) {
    fail(
      `${ownerPath} ${fnName}() ${label} template differs from the pinned PrepShip source.\n` +
        `  local:  ${ws(template)}\n  pinned: ${ws(pinned)}`,
    );
  } else {
    pass(`${fnName}() spells the ${label} CASE exactly as PrepShip's source (whitespace-normalised)`);
  }
}

// 2. RENDERED parity: what actually reaches Postgres, compiled by PgDialect.
{
  let rendered = null;
  try {
    const out = execFileSync('npx', ['tsx', contract.portal.renderHelper], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    rendered = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } catch (error) {
    fail(`could not render the order-lifecycle SQL: ${String(error).split('\n')[0]}`);
  }
  if (rendered) {
    for (const [label, text] of [['table-form', rendered.effective], ['alias-form o', rendered.alias]]) {
      if (normaliseSql(text) !== pinnedCanonical) {
        fail(
          `the RENDERED ${label} effective-status CASE differs from the pinned canonical text.\n` +
            `  rendered: ${normaliseSql(text)}\n  pinned:   ${pinnedCanonical}`,
        );
      } else {
        pass(`the rendered ${label} effective-status CASE equals the pinned canonical text`);
      }
    }
    // Drizzle must bind the table form to the real `orders` columns (not a raw spelling) and the
    // alias form to the alias — the reduction above is what makes them comparable, so check the
    // unreduced shapes too.
    if (!/"orders"\."order_status"/.test(rendered.effective)) {
      fail('the table-form CASE no longer renders bound "orders" columns');
    }
    if (!/\bo\.order_status\b/.test(rendered.alias) || /"orders"/.test(rendered.alias)) {
      fail('the alias-form CASE no longer renders alias-qualified columns');
    }

    // The Orders tab / count predicates render on the INNER CASE (PS 0057 index eligibility).
    const effectiveRendered = ws(rendered.effective);
    for (const bucket of ['pending', 'shipped', 'cancelled']) {
      const predicate = ws(rendered.predicates[bucket]);
      const expected = ws(
        contract.effectiveStatusCase.bucketPredicates[bucket].replace('{effective}', effectiveRendered),
      );
      if (predicate !== expected) {
        fail(
          `portalOrderFulfillmentBucketPredicateSql('${bucket}') does not render as the pinned ` +
            `predicate on the inner CASE.\n  rendered: ${predicate}\n  expected: ${expected}`,
        );
      } else {
        pass(`portalOrderFulfillmentBucketPredicateSql('${bucket}') renders on the inner effective CASE`);
      }
    }

    // The customer LIST admission carries PrepShip's is_return arm plus the documented
    // source <> 'replacement' deviation — and nothing else (voided is applied per surface).
    const outbound = ws(rendered.outbound).replace(/"shipments"\."(is_return|source)"/g, '$1');
    if (outbound !== ws(contract.activeOutboundPredicate.portalListAdmission)) {
      fail(
        `outboundShipmentPredicate() differs from the pinned customer list admission.\n` +
          `  rendered: ${outbound}\n  pinned:   ${ws(contract.activeOutboundPredicate.portalListAdmission)}`,
      );
    } else {
      pass('outboundShipmentPredicate() renders the pinned list admission (is_return arm + replacement deviation)');
    }
  }
}

// 3. The shipped-label display precedence is ported verbatim, in order.
{
  const statements = displayStateStatements(owner);
  if (!statements) {
    fail(`could not find resolveShippedLabelDisplayState in ${ownerPath}`);
  } else if (statements.join('\n') !== pinnedBody.join('\n')) {
    fail(
      `resolveShippedLabelDisplayState in ${ownerPath} no longer matches the pinned precedence.\n` +
        `  local:\n    ${statements.join('\n    ')}\n  pinned:\n    ${pinnedBody.join('\n    ')}`,
    );
  } else {
    pass('resolveShippedLabelDisplayState carries the pinned 5-step precedence, in order');
  }
}

// 4. The order-grain match keeps PrepShip's is_return arm and the tenant-scope deviation.
{
  const match = functionBodyOf(owner, contract.portal.exports.orderMatch);
  const arms = contract.activeOutboundPredicate.portalOrderMatchArms;
  if (!match) {
    fail(`could not find ${contract.portal.exports.orderMatch} in ${ownerPath}`);
  } else {
    for (const [label, arm] of Object.entries(arms)) {
      if (ws(match).includes(ws(arm))) pass(`${contract.portal.exports.orderMatch} keeps the ${label} arm`);
      else fail(`${contract.portal.exports.orderMatch} lost the ${label} arm: ${arm}`);
    }
    if (/replacement/.test(match)) {
      fail(`${contract.portal.exports.orderMatch} must not carry a source <> 'replacement' arm (documented no-op, list surfaces only)`);
    }
  }
}

// 5. The resolver gates the display state on the shipped bucket and projects voided_label only.
{
  const resolver = readLocal(contract.portal.resolver);
  const gated = /if \(bucket === 'shipped'\) \{[\s\S]*?resolveShippedLabelDisplayState\(/.test(resolver);
  const projected = /display === 'voided_label' \? 'voided' : 'shipped'/.test(resolver);
  const noLegacyArms = !/'canceled'|'refunded'/.test(resolver);
  if (gated && projected) pass(`${contract.portal.resolver} evaluates the display state only on the shipped bucket and projects voided_label -> voided`);
  else fail(`${contract.portal.resolver} no longer gates resolveShippedLabelDisplayState on the shipped bucket / projects voided_label -> voided`);
  if (noLegacyArms) pass(`${contract.portal.resolver} carries no 'canceled' / 'refunded' arm (deviation D7)`);
  else fail(`${contract.portal.resolver} re-introduced a 'canceled' / 'refunded' arm PrepShip does not have`);
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
  const fetchUpstream = (path) => {
    try {
      const meta = JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/contents/${path}?ref=${ref}`], {
          encoding: 'utf8',
          env: { ...process.env, GH_TOKEN: token },
        }),
      );
      return { sha: meta.sha, source: Buffer.from(meta.content, 'base64').toString('utf8').replace(/\r\n/g, '\n') };
    } catch (error) {
      fail(`could not read ${repo}/${path}@${ref.slice(0, 8)}: ${String(error).split('\n')[0]}`);
      return null;
    }
  };

  const remote = {};
  for (const [key, pin] of Object.entries(upstreamFiles)) {
    const fetched = fetchUpstream(pin.path);
    if (!fetched) continue;
    remote[key] = fetched;
    if (fetched.sha !== pin.blobSha) {
      fail(
        `upstream ${pin.path} at ${ref.slice(0, 8)} is not the pinned blob (pinned ${pin.blobSha.slice(0, 8)}, ` +
          `upstream ${String(fetched.sha).slice(0, 8)}) — the contract was transcribed from a different commit. Re-pin and re-prove the port.`,
      );
    } else {
      pass(`upstream ${pin.path} at the pinned commit is the pinned blob (${pin.blobSha.slice(0, 8)})`);
    }
  }

  // DRIFT detection proper. A blob at an immutable commit cannot move, so the checks above only
  // prove the pin transcribes that commit. What CAN move is the branch Render deploys: read the
  // three owner files at the deployed branch head and fail the moment any differs from the pin —
  // that is when PrepShip's owner changed and the portal's port must be re-proven and re-pinned.
  const deployedRef = contract.upstream.deployedRef ?? 'prepshipv4-stable';
  for (const [, pin] of Object.entries(upstreamFiles)) {
    try {
      const meta = JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/contents/${pin.path}?ref=${deployedRef}`], {
          encoding: 'utf8',
          env: { ...process.env, GH_TOKEN: token },
        }),
      );
      if (meta.sha !== pin.blobSha) {
        fail(
          `DRIFT: ${pin.path} on the deployed branch ${deployedRef} is ${String(meta.sha).slice(0, 8)}, ` +
            `the pin is ${pin.blobSha.slice(0, 8)} (@ ${ref.slice(0, 8)}). PrepShip's lifecycle owner moved — ` +
            `re-prove the port against ${deployedRef} (sibling parity lane) and re-pin the contract.`,
        );
      } else {
        pass(`${pin.path} on the deployed branch ${deployedRef} still equals the pin`);
      }
    } catch (error) {
      fail(`could not read ${repo}/${pin.path}@${deployedRef}: ${String(error).split('\n')[0]}`);
    }
  }

  // The SHA says whether upstream moved; the text says whether what we pinned is still what
  // upstream spells. Both, so a re-pin that copies the wrong text cannot pass.
  if (remote.orderLifecycleStatus) {
    const source = remote.orderLifecycleStatus.source;
    for (const [label, fnName, pinned] of [
      ['table-form', 'orderLifecycleEffectiveStatusSql', contract.effectiveStatusCase.source],
      ['alias-form', 'orderLifecycleEffectiveStatusAliasSql', contract.effectiveStatusCase.aliasSource],
    ]) {
      const template = templateOf(source, fnName);
      if (!template) {
        fail(`could not read ${fnName}() from the upstream file. If upstream renamed or restructured it, re-pin rather than loosening this reader.`);
      } else if (ws(template) !== ws(pinned)) {
        fail(
          `upstream ${fnName}() ${label} template differs from the pin.\n` +
            `  upstream: ${ws(template)}\n  pinned:   ${ws(pinned)}`,
        );
      } else {
        pass(`upstream ${fnName}() ${label} CASE text equals the pin`);
      }
    }
  }
  if (remote.shippedLabelDisplayState) {
    const statements = displayStateStatements(remote.shippedLabelDisplayState.source);
    if (!statements) {
      fail('could not read resolveShippedLabelDisplayState from the upstream file');
    } else if (statements.join('\n') !== pinnedBody.join('\n')) {
      fail(
        `upstream resolveShippedLabelDisplayState precedence differs from the pin.\n` +
          `  upstream:\n    ${statements.join('\n    ')}\n  pinned:\n    ${pinnedBody.join('\n    ')}`,
      );
    } else {
      pass('upstream resolveShippedLabelDisplayState precedence equals the pin');
    }
  }
  if (remote.shipmentAggregate) {
    const body = functionBodyOf(remote.shipmentAggregate.source, 'activeOutboundShipmentPredicate');
    const wanted = contract.activeOutboundPredicate.upstreamSource;
    if (!body) {
      fail('could not read activeOutboundShipmentPredicate from the upstream file');
    } else {
      const lost = wanted.filter((arm) => !ws(body).includes(ws(arm)));
      if (lost.length) fail(`upstream activeOutboundShipmentPredicate lost pinned arm(s): ${lost.join('; ')}`);
      else pass('upstream activeOutboundShipmentPredicate still carries voided = false AND is_return = false');
    }
  }
}

if (failed) {
  console.error('\n✖ prepship order-lifecycle display parity gate failed.');
  process.exit(1);
}
console.log('\nPASS prepship order-lifecycle display parity');
