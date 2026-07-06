// Guard: Returns must make the return-label PDF state obvious from the list,
// and the detail drawer must explain when a PDF is not ready yet.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    failed = true;
  } else {
    console.log(`PASS ${message}`);
  }
}

const page = read('portal-client/src/pages/Returns.tsx');
const pkg = JSON.parse(read('package.json'));

assert(
  pkg.scripts?.['test:client-portal-returns-pdf-download'] ===
    'node scripts/client-portal-returns-pdf-download-guard.mjs',
  'package exposes test:client-portal-returns-pdf-download',
);
assert(/header:\s*'Label PDF'/.test(page), 'Returns table has a Label PDF column');
assert(/r\.pdfAvailable/.test(page), 'Returns table renders the backend pdfAvailable flag');
assert(/Download/.test(page) && /setSelectedId\(r\.id\)/.test(page), 'Returns table has an obvious Download entry that opens the return detail');
assert(/Label pending/.test(page), 'Returns table explains when the label PDF is pending');
assert(/Return label PDF is not ready yet/.test(page), 'Return detail explains why no PDF button is shown yet');
assert(/Create return label/.test(page), 'Return detail lets a pending return retry PrepShip label creation');
assert(/portalApi\.createReturnLabel/.test(page), 'Return detail retry delegates to the backend return-label endpoint');
assert(/Download return label/.test(page) && /pdfHref/.test(page), 'Return detail still exposes the actual PDF download link when ready');

if (failed) process.exit(1);
console.log('\nclient portal returns PDF download guard passed.');
