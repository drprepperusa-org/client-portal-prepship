// CP-038 — client-portal built-bundle redaction guard.
//
// Frontend route guards are NOT a secrecy boundary — a client can download any lazy
// chunk — so this asserts the COMPILED output, not source. After
// `npm --prefix portal-client run build`, it scans portal-client/dist/assets/*.js and
// FAILs if admin/internal house-cost vocabulary appears in a client-loadable chunk.
//
// BUILD-DEPENDENT: intentionally excluded from the static run-guards suite (see the
// DENY regex in scripts/run-guards.mjs). Runs after build:web in
// test:full-site-certification and in CI's build job.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetsDir = path.join(root, 'portal-client/dist/assets');

// Specific house/internal tokens only. Deliberately NOT bare `margin`/`profit`:
// `margin` ships as a Recharts chart-prop key in the compiled JS, and markup /
// "profit layer" vocabulary lives only in the allowlisted admin Settings chunk.
const FORBIDDEN = [
  'label_cost',
  'labelCost',
  'selectedRate',
  'selected_rate',
  'standard_shipping_cost',
  'shipAlloc',
  'shipUnits',
];

// Chunks allowed to contain admin vocabulary. The Markups admin UI is RequireAdmin-gated
// and code-split; relocating it out of the customer bundle is the tracked follow-up
// (CP-038b). Until then its chunk is allowlisted by filename prefix.
const ALLOWLIST_PREFIXES = ['Settings-'];
const isAllowlisted = (file) => ALLOWLIST_PREFIXES.some((p) => file.startsWith(p));

if (!fs.existsSync(assetsDir)) {
  console.error(
    `FAIL bundle-redaction: ${assetsDir} not found — run \`npm --prefix portal-client run build\` first.`,
  );
  process.exit(1);
}
const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (jsFiles.length === 0) {
  console.error('FAIL bundle-redaction: no JS assets in the build output.');
  process.exit(1);
}

let failed = false;
for (const file of jsFiles) {
  if (isAllowlisted(file)) {
    console.log(`skip  ${file} (allowlisted admin chunk)`);
    continue;
  }
  const text = fs.readFileSync(path.join(assetsDir, file), 'utf8');
  for (const term of FORBIDDEN) {
    if (text.includes(term)) {
      console.error(`FAIL  ${file} contains forbidden term "${term}"`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nbundle-redaction guard FAILED — admin/internal vocabulary in a client chunk.');
  process.exit(1);
}
console.log(`\nbundle-redaction guard passed (${jsFiles.length} chunks scanned).`);
