import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// postgres.js 3.4.9 can skip BEGIN's reservation hook when max_pipeline=0 or
// socket.write accepts bytes with backpressure. Reserve after accepting the
// write, independently of whether another query may be pipelined.
// https://github.com/porsager/postgres/issues/1189
// Keep this pinned and fail installation on dependency drift. No runtime patching.
const root = fileURLToPath(new URL('../node_modules/postgres/', import.meta.url));
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (version !== '3.4.9') throw Error('Review transaction compatibility before changing postgres@3.4.9');
const before = `      return write(toBuffer(q))
        && !q.describeFirst
        && !q.cursorFn
        && sent.length < max_pipeline
        && (!q.options.onexecute || q.options.onexecute(connection))`;
const after = `      // PrepShip transaction compatibility: reservation must survive backpressure/pipeline limits.
      const canPipeline = write(toBuffer(q))
      const reserved = !q.options.onexecute || q.options.onexecute(connection)
      return canPipeline
        && !q.describeFirst
        && !q.cursorFn
        && sent.length < max_pipeline
        && reserved`;
const files = ['src/connection.js', 'cjs/src/connection.js', 'cf/src/connection.js'];
// Validate every target before writing any; repeat installs are idempotent.
const patches = files.map(file => {
  const path = resolve(root, file);
  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const oldCount = source.split(before).length - 1;
  const newCount = source.split(after).length - 1;
  if (oldCount === 0 && newCount === 1) return { path, source, changed: false };
  if (oldCount !== 1 || newCount !== 0) throw Error(`Unexpected postgres transaction implementation: ${file}`);
  return { path, source: source.replace(before, after), changed: true };
});
for (const patch of patches) if (patch.changed) writeFileSync(patch.path, patch.source);
console.log('postgres@3.4.9 transaction compatibility verified (ESM, CJS, Cloudflare)');
