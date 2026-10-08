/** Regenerate from committed PrepShip source, never the producer's working tree or a database. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const repository = process.argv[2];
if (!repository) throw new Error('Usage: tsx scripts/fixtures/generate-customs-duties.mts <prepship repository>');
const producerSha = '0e17f480';
const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trimEnd();
const resolvedSha = git('rev-parse', producerSha);
const require = createRequire(import.meta.url);
const modules = new Map<string, { exports: any }>();
function load(file: string): any {
  if (modules.has(file)) return modules.get(file)!.exports;
  const source = git('show', `${resolvedSha}:${file}`);
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  modules.set(file, module);
  const localRequire = (name: string) => {
    if (name.startsWith('.')) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), name)).replace(/\.js$/, '');
      return load(`${dependency}.ts`);
    }
    if (name !== 'node:crypto' && name !== 'drizzle-orm') throw new Error(`Unexpected producer dependency: ${name}`);
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(localRequire, module, module.exports);
  return module.exports;
}
const { toBillingDetailOrderRows } = load('src/services/billing-detail-row-sot.ts');
const { summarizeBillingItemsForDetail } = load('src/services/billing-detail-utils.ts');
const base = { clientId: 7, orderId: 3410, orderNumber: '3410', shipDate: '2026-10-08',
  billingEffectiveDate: '2026-10-08', destinationCountry: 'CA', orderStatus: 'shipped', qty: '1.00' };
const ordinary = [
  { ...base, lineType: 'pick_pack', totalCost: '2.50' },
  { ...base, lineType: 'additional_unit', totalCost: '1.00' },
  { ...base, lineType: 'package_cost', totalCost: '0.99' },
  { ...base, shipmentId: 1, lineType: 'shipping', totalCost: '15.00' },
  { ...base, shipmentId: 2, lineType: 'shipping', totalCost: '5.83' },
];
const duty = { ...base, lineType: 'customs_duties', totalCost: '3.49' };
const cases = [
  { name: 'split-shipment-duty', lines: [...ordinary, duty] },
  { name: 'explicit-zero', lines: [...ordinary, { ...duty, totalCost: '0.00' }] },
  { name: 'missing-duty', lines: ordinary },
  { name: 'cancelled', lines: [...ordinary, duty].map(line => ({ ...line, orderStatus: 'cancelled', cancelledNoChargeBillingLine: true })) },
  { name: 'independent-return', lines: [...ordinary, duty, { ...base, returnId: 41, lineType: 'return_postage', totalCost: '4.25' }] },
  { name: 'fractional-cents-sum', lines: [...ordinary, { ...duty, totalCost: '0.10' }, { ...duty, totalCost: '0.20' }] },
  { name: 'quantity-three-items', lines: ordinary.map(line => ({ ...line, ...summarizeBillingItemsForDetail([
    { sku: 'Booster-gel-001', quantity: 2 }, { sku: 'HU-10', quantity: 1 },
  ]) })) },
  { name: 'quantity-four-items', lines: ordinary.map(line => ({ ...line, ...summarizeBillingItemsForDetail([
    { sku: 'Booster-gel-001', quantity: 4 },
  ]) })) },
];
const shapes = cases.map(({ name, lines }) => ({ name, lines, rows: toBillingDetailOrderRows(lines) }));
const contentHash = createHash('sha256').update(JSON.stringify(shapes)).digest('hex');
writeFileSync('fixtures/customs-duties-producer-rows.json', JSON.stringify({ producerSha: resolvedSha, contentHash, shapes }, null, 2) + '\n');
console.log(`Generated ${shapes.length} customs/duties shapes from PrepShip ${resolvedSha}.`);
