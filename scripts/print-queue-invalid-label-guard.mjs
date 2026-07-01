import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const routeSource = read('src/routes/print-queue.ts');
// Print-queue service split into sibling modules; assert over the concatenation.
const serviceSource = [
  'src/services/print-queue-types.ts',
  'src/services/print-queue-labels.ts',
  'src/services/print-queue-snapshots.ts',
  'src/services/print-queue-scope.ts',
  'src/services/print-queue.ts',
].map(read).join('\n');

assert(
  routeSource.includes('isPrintQueueLabelUrlError') &&
    routeSource.includes('printQueueLabelUrlErrorResponse'),
  'print queue routes return typed invalid-label errors',
);

assert(
  routeSource.includes('label_url: z.unknown()') &&
    routeSource.includes('labelUrl: b.label_url'),
  'print queue add route lets service validation reject unsafe label values',
);

assert(
  serviceSource.includes('class PrintQueueLabelUrlError extends Error') &&
    serviceSource.includes("code = 'INVALID_LABEL_URL'"),
  'print queue service defines a typed invalid-label error',
);

assert(
  serviceSource.includes('extractShipstationLabelUrl(labelUrl)') &&
    serviceSource.includes("typeof normalized !== 'string'") &&
    serviceSource.includes('trimmed.length === 0') &&
    serviceSource.includes("trimmed === '[object Object]'"),
  'print queue service unwraps known label URL objects and rejects empty/object-sentinel label URLs',
);

assert(
  serviceSource.includes('const labelUrl = normalizePrintQueueLabelUrl(input.labelUrl)') &&
    serviceSource.includes('labelUrl,'),
  'print queue add normalizes label URLs before insert/update',
);

assert(
  serviceSource.includes('function resolveLabelFetchUrl(labelUrl: unknown') &&
    serviceSource.includes('normalizePrintQueueLabelUrl(labelUrl)'),
  'print queue merge URL resolver validates unknown label values',
);

assert(
  serviceSource.includes('collectInvalidLabelErrors(entries)') &&
    serviceSource.includes('All selected labels have invalid URLs'),
  'print queue start job rejects all-invalid label selections with a clear summary',
);

assert(
  serviceSource.includes('formatLabelUrlError(e, err)') &&
    serviceSource.includes('failedEntryIds.add(e.id)') &&
    serviceSource.includes('continue;'),
  'print queue merge records invalid label URLs as per-label failures',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
