import assert from 'node:assert/strict';
import net from 'node:net';

// Reproduces the 2026-08 readiness wedge at the client layer.
//
// Production pattern (hours-stable until a restart): one DB probe ok in ~130ms,
// the other two failing at exactly the client budget, Postgres logs showing no
// statement-timeout cancels or terminations for them. The stalled probes never
// reach a backend; they sit on a health-pool connection that stopped answering.
//
// Mechanism (postgres.js 3.4): a query that never receives ReadyForQuery keeps
// its connection in the pool's `busy` list forever — no socket-level timeout
// exists for an in-flight query, and `withTimeout` only abandons the promise.
// Every later probe that finds no idle connection is pipelined onto a busy one
// (`handler`: `busy.length ? go(busy.shift(), query)`), and pipelined queries
// only start when the previous query's ReadyForQuery arrives. One stall
// therefore poisons a slot permanently, and the only cure was a process restart.
//
// This fixture stands up a fake Postgres that answers every query with zero
// rows, then silences ONE established connection on a chosen probe query. The
// assertion under test: the probe after the stall must be fully green, i.e. a
// probe that times out must release/evict its connection instead of retaining
// it for the next probe to land on.

// `armed` holds query fragments; the first connection to send a matching Parse
// goes silent and the fragment is consumed, so arming N fragments wedges
// exactly N distinct connections in one readiness round.
type Stall = { armed: string[]; silenced: net.Socket[]; closed: number };

function backendMessage(type: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, 1, 'latin1');
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.alloc(1)]);
}

function startFakePostgres(stall: Stall): Promise<{ server: net.Server; port: number; connections: number }> {
  const state = { server: net.createServer(), port: 0, connections: 0 };

  state.server.on('connection', (socket) => {
    state.connections += 1;
    let startupDone = false;
    let silenced = false;
    let buffered = Buffer.alloc(0);

    const reply = (...messages: Buffer[]) => {
      if (silenced || socket.destroyed) return;
      socket.write(Buffer.concat(messages));
    };

    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);

      while (true) {
        if (!startupDone) {
          if (buffered.length < 8) return;
          const length = buffered.readInt32BE(0);
          if (buffered.length < length) return;
          buffered = buffered.subarray(length);
          startupDone = true;
          const key = Buffer.alloc(8);
          key.writeInt32BE(state.connections, 0);
          key.writeInt32BE(42, 4);
          const authOk = Buffer.alloc(4);
          reply(
            backendMessage('R', authOk),
            backendMessage('S', Buffer.concat([cstring('server_version'), cstring('17.0')])),
            backendMessage('K', key),
            backendMessage('Z', Buffer.from('I')),
          );
          continue;
        }

        if (buffered.length < 5) return;
        const type = String.fromCharCode(buffered[0]!);
        const length = buffered.readInt32BE(1);
        if (buffered.length < length + 1) return;
        const payload = buffered.subarray(5, length + 1);
        buffered = buffered.subarray(length + 1);

        if (type === 'P') {
          // Parse: name\0 query\0 ...
          const nameEnd = payload.indexOf(0);
          const queryEnd = payload.indexOf(0, nameEnd + 1);
          const query = payload.subarray(nameEnd + 1, queryEnd).toString('utf8');
          const armedIndex = stall.armed.findIndex((fragment) => query.includes(fragment));
          if (armedIndex !== -1) {
            // From here on this connection never answers again, but the socket
            // stays open — the shape of a pooler that lost its backend.
            stall.armed.splice(armedIndex, 1);
            stall.silenced.push(socket);
            silenced = true;
            socket.once('close', () => {
              stall.closed += 1;
            });
            continue;
          }
          reply(backendMessage('1'));
        } else if (type === 'D') {
          const noParams = Buffer.alloc(2);
          reply(backendMessage('t', noParams), backendMessage('n'));
        } else if (type === 'B') {
          reply(backendMessage('2'));
        } else if (type === 'E') {
          reply(backendMessage('C', cstring('SELECT 0')));
        } else if (type === 'S') {
          reply(backendMessage('Z', Buffer.from('I')));
        } else if (type === 'C') {
          reply(backendMessage('3'));
        } else if (type === 'X') {
          socket.end();
        } else if (type === 'H') {
          // Flush: nothing buffered on our side.
        }
      }
    });

    socket.on('error', () => {
      /* client went away */
    });
  });

  return new Promise((resolve) => {
    state.server.listen(0, '127.0.0.1', () => {
      state.port = (state.server.address() as net.AddressInfo).port;
      resolve(state);
    });
  });
}

const stall: Stall = { armed: [], silenced: [], closed: 0 };
const fake = await startFakePostgres(stall);

process.env.DATABASE_URL = `postgres://user:pass@127.0.0.1:${fake.port}/fake`;
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.SUPABASE_JWT_SECRET ||= 'test';
// Small budgets keep the fixture fast; the behaviour under test is independent
// of their size.
process.env.DB_HEALTH_TIMEOUT_MS = '800';
process.env.DB_POOL_HEALTH_TIMEOUT_MS = '500';
process.env.DB_CONNECT_TIMEOUT_SECONDS = '1';

const { checkDeepReadiness } = await import('../src/routes/health');

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const line = args.map(String).join(' ');
  if (!line.startsWith('[health:ready]')) originalConsoleError(...args);
};

function summarize(readiness: Awaited<ReturnType<typeof checkDeepReadiness>>) {
  return readiness.components.map((c) => `${c.name}=${c.status}@${c.latencyMs}ms`).join(' ');
}

// Round 1: healthy server, every probe green. Establishes the pool.
const round1 = await checkDeepReadiness();
assert.equal(round1.ok, true, `round 1 must be green on a healthy server: ${summarize(round1)}`);
console.log(`ok: round 1 green (${summarize(round1)})`);

// Round 2: the connection that receives the orders probe goes silent mid-flight.
stall.armed = ['from orders'];
const round2 = await checkDeepReadiness();
const ordersRound2 = round2.components.find((c) => c.name === 'orders');
assert.equal(ordersRound2?.status, 'fail', `round 2 orders probe must time out: ${summarize(round2)}`);
assert.equal(stall.silenced.length, 1, 'the fake server must have silenced exactly one connection');
console.log(`ok: round 2 orders probe timed out on the silenced connection (${summarize(round2)})`);

// Round 3: the server is healthy for every other connection. The silenced one
// still holds its socket open and will never answer. Readiness must be green —
// a stalled probe must not leave a poisoned slot behind for the next probe.
const startedAt = Date.now();
const round3 = await checkDeepReadiness();
const elapsedMs = Date.now() - startedAt;
assert.equal(
  round3.ok,
  true,
  `round 3 must be green after one stalled probe; a retained wedged connection poisons later probes: ${summarize(round3)}`,
);
console.log(`ok: round 3 green after the stall (${summarize(round3)})`);
assert.ok(
  elapsedMs < 700,
  `round 3 must not spend the probe budget waiting on the wedged connection (took ${elapsedMs}ms)`,
);
console.log(`ok: round 3 answered in ${elapsedMs}ms`);

// The stalled connection must have been torn down client-side, not merely
// abandoned: the fake server observes its socket close.
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(
  stall.closed,
  1,
  'a probe connection that timed out must be closed by the client, not retained in the pool',
);
console.log('ok: the wedged connection was closed by the client');

// Round 4: TWO connections wedge in the same round. This reproduces the exact
// production signature seen on 2026-08-20/21 — db ok in ~130ms, orders and
// printQueue both failing at exactly the client budget, stable across every
// probe for hours.
//
// Why that shape, and why it is stable: the health pool is max 3 and
// checkDeepReadiness dispatches db, orders, printQueue in that order.
// postgres.js hands each a separate connection while any is closed/idle, so
// with two connections wedged in `busy` the single healthy one is always taken
// by the first dispatch (db), and the remaining two probes are pipelined onto
// the wedged connections, where they can never start — a pipelined query only
// begins when the previous query's ReadyForQuery arrives. The healthy
// connection cycles through idle_timeout and is re-established each round
// (hence db's fast-but-not-instant latency); the wedged ones are never idle,
// so idle_timeout never reclaims them.
stall.armed = ['from orders', 'print_queue_orders'];
const round4 = await checkDeepReadiness();
const signature = round4.components
  .filter((c) => ['db', 'orders', 'printQueue'].includes(c.name))
  .map((c) => `${c.name}=${c.status}`)
  .join(' ');
assert.equal(
  signature,
  'db=ok orders=fail printQueue=fail',
  `round 4 must reproduce the production signature, got: ${summarize(round4)}`,
);
assert.equal(stall.silenced.length, 3, 'two further connections must have gone silent');
console.log(`ok: round 4 reproduced the production signature (${summarize(round4)})`);

// Round 5: both wedged connections must be gone, not just one.
const round5 = await checkDeepReadiness();
assert.equal(
  round5.ok,
  true,
  `round 5 must be green after a two-connection wedge: ${summarize(round5)}`,
);
console.log(`ok: round 5 green after the double stall (${summarize(round5)})`);

await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(
  stall.closed,
  3,
  `every wedged connection must be closed by the client (closed ${stall.closed} of 3)`,
);
console.log('ok: both wedged connections from the double stall were closed');

console.error = originalConsoleError;
console.log('\nhealth wedged-pool runtime fixtures passed.');
process.exit(0);
