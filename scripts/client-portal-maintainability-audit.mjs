import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const FILE_LIMIT = 500;
const FUNCTION_LIMIT = 350;
const scanRoots = [
  path.join(root, 'portal-client', 'src'),
  path.join(root, 'src', 'routes', 'client-portal'),
];
const exceptions = new Map([
  ['src/routes/client-portal/returns.ts', 904],
]);
const excludedPathParts = [
  '/components/store/logos/',
  '/components/store-connections/logos/',
  '/dist/',
  '/generated/',
];

function normalize(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const normalized = `/${normalize(filePath)}`;
    if (excludedPathParts.some((part) => normalized.includes(part))) continue;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(filePath));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(filePath);
    }
  }
  return files;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node);
}

function functionName(node, sourceFile, line) {
  if ('name' in node && node.name) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText(sourceFile);
  return `anonymous@${line}`;
}

function functionSizes(sourceText, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sizes = [];
  function visit(node) {
    if (isFunctionLike(node)) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      sizes.push({ name: functionName(node, sourceFile, start), start, lines: end - start + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return sizes;
}

const files = (await Promise.all(scanRoots.map(collectFiles))).flat();
const failures = [];
const measurements = [];

for (const filePath of files) {
  const relativePath = normalize(filePath);
  const sourceText = await readFile(filePath, 'utf8');
  const physicalLines = sourceText.split(/\r?\n/);
  if (physicalLines.at(-1) === '') physicalLines.pop();
  const lineCount = physicalLines.length;
  const exceptionCeiling = exceptions.get(relativePath);
  measurements.push({ relativePath, lineCount });

  if (exceptionCeiling != null) {
    if (lineCount > exceptionCeiling) {
      failures.push(`${relativePath}: ${lineCount} lines exceeds frozen baseline ${exceptionCeiling}`);
    }
  } else if (lineCount > FILE_LIMIT) {
    failures.push(`${relativePath}: ${lineCount} lines exceeds file limit ${FILE_LIMIT}`);
  }
  for (const size of functionSizes(sourceText, filePath)) {
    if (size.lines > FUNCTION_LIMIT) {
      failures.push(
        `${relativePath}:${size.start} ${size.name}: ${size.lines} lines exceeds function limit ${FUNCTION_LIMIT}`,
      );
    }
  }
}

measurements.sort((left, right) => right.lineCount - left.lineCount);
console.log(`Client Portal maintainability audit: ${files.length} TypeScript files`);
console.log('Largest files:');
for (const measurement of measurements.slice(0, 10)) {
  const ceiling = exceptions.get(measurement.relativePath);
  const suffix = ceiling == null ? '' : ` (frozen exception ≤ ${ceiling})`;
  console.log(`  ${measurement.lineCount.toString().padStart(4)}  ${measurement.relativePath}${suffix}`);
}

if (failures.length) {
  console.error(`FAIL maintainability audit (${failures.length} violation${failures.length === 1 ? '' : 's'})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`PASS files ≤ ${FILE_LIMIT} lines and functions/components ≤ ${FUNCTION_LIMIT} lines.`);
