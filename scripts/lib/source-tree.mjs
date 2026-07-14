import fs from 'node:fs';
import path from 'node:path';

const TYPESCRIPT_SOURCE = /\.(?:ts|tsx)$/;

function resolveInsideRoot(root, input) {
  const resolved = path.resolve(root, input);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Source-tree path escapes repository root: ${input}`);
  }
  return resolved;
}

function collectTypeScriptFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (!TYPESCRIPT_SOURCE.test(target)) {
      throw new Error(`Source-tree file must be TypeScript: ${target}`);
    }
    return [target];
  }
  if (!stat.isDirectory()) throw new Error(`Source-tree path is not a file or directory: ${target}`);

  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source-tree directory contains a symlink: ${entryPath}`);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    if (entry.isFile() && TYPESCRIPT_SOURCE.test(entry.name)) return [entryPath];
    return [];
  });
}

export function sourceTreeFiles(inputs, root = process.cwd()) {
  const requested = Array.isArray(inputs) ? inputs : [inputs];
  if (!requested.length) throw new Error('Source-tree requires at least one path');

  const files = requested
    .flatMap((input) => collectTypeScriptFiles(resolveInsideRoot(root, input)))
    .sort((left, right) => left.localeCompare(right));
  if (!files.length) throw new Error('Source-tree contains no TypeScript files');

  const unique = new Set(files);
  if (unique.size !== files.length) throw new Error('Source-tree contains duplicate files');
  return files;
}

export function readSourceTree(inputs, root = process.cwd()) {
  return sourceTreeFiles(inputs, root)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}
