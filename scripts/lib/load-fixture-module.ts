import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

/** Execute the real TS owner with explicitly substituted I/O boundaries, offline. */
export function loadFixtureModule(path: string, boundaries: Record<string, unknown>, source?: string): any {
  const filename = resolve(path);
  const require = createRequire(filename);
  const code = ts.transpileModule(source ?? readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
    (id: string) => Object.hasOwn(boundaries, id) ? boundaries[id] : require(id),
    module, module.exports, filename, resolve(filename, '..'),
  );
  return module.exports;
}
