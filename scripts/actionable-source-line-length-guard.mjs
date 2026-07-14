import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_LENGTH = 240;
const INCLUDE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.scss',
  '.sql',
  '.ts',
  '.tsx',
]);

const INCLUDE_ROOTS = ['api/', 'portal-client/src/', 'scripts/', 'src/'];
const EXCLUDED_PATH_PARTS = [
  '/components/store/logos/',
  '/components/store-connections/logos/',
  '/dist/',
  '/build/',
  '/coverage/',
];

function isIncluded(file) {
  const normalized = file.replaceAll('\\', '/');
  return (
    INCLUDE_ROOTS.some((root) => normalized.startsWith(root)) &&
    INCLUDE_EXTENSIONS.has(path.extname(normalized).toLowerCase()) &&
    !EXCLUDED_PATH_PARTS.some((part) => normalized.includes(part))
  );
}

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter(isIncluded)
  .filter(existsSync);

const failures = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.length <= MAX_LENGTH) return;
    failures.push({
      file,
      line: index + 1,
      length: line.length,
      snippet: line.trim().slice(0, 120),
    });
  });
}

if (failures.length) {
  console.error(`Found ${failures.length} actionable source line(s) longer than ${MAX_LENGTH} characters.`);
  for (const failure of failures.slice(0, 50)) {
    console.error(`${failure.file}:${failure.line} (${failure.length}) ${failure.snippet}`);
  }
  if (failures.length > 50) {
    console.error(`...and ${failures.length - 50} more.`);
  }
  process.exit(1);
}

console.log(`PASS actionable source line length guard (${files.length} files, max ${MAX_LENGTH} chars).`);
