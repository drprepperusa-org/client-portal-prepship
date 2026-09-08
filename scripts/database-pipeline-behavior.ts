import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import postgres from 'postgres';
import { loadFixtureModule } from './lib/load-fixture-module';

// A loopback PostgreSQL wire peer, not a mocked sql() function. Exercise the
// installed postgres.js driver and actual application connection options.
// Model the transaction-proxy failure: overlapping implicit transactions lose
// their replies. No production database, credentials, or provider is used.
function packet(type: string, body = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.write(type); header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}
function i16(value: number): Buffer { const b = Buffer.alloc(2); b.writeInt16BE(value); return b; }
function i32(value: number): Buffer { const b = Buffer.alloc(4); b.writeInt32BE(value); return b; }
const rowDescription = packet('T', Buffer.concat([
  i16(1), Buffer.from('n\0'), i32(0), i16(0), i32(23), i16(4), i32(-1), i16(0),
]));
const ready = packet('Z', Buffer.from('I'));

async function exercise(max: number, overridePipeline?: number, backpressure = false) {
  const sockets = new Set<net.Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let maxOutstanding = 0, pressuredWrites = 0;
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0), startup = true, outstanding = 0, poisoned = false, inTransaction = false;
    let command = 'SELECT';
    let replies: Buffer[] = [];
    const startQuery = () => {
      outstanding++;
      maxOutstanding = Math.max(maxOutstanding, outstanding);
      if (outstanding > 1) poisoned = true;
    };
    const finishQuery = () => {
      if (command === 'BEGIN') inTransaction = true;
      if (command === 'COMMIT' || command === 'ROLLBACK') inTransaction = false;
      const response = Buffer.concat([...replies, packet('Z', Buffer.from(inTransaction ? 'T' : 'I'))]); replies = [];
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (poisoned || socket.destroyed) return;
        outstanding--;
        socket.write(response);
      }, 10);
      timers.add(timer);
    };
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= (startup ? 4 : 5)) {
        const length = buffer.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
        if (buffer.length < length) return;
        const frame = buffer.subarray(0, length); buffer = buffer.subarray(length);
        if (startup) {
          startup = false;
          socket.write(Buffer.concat([packet('R', i32(0)), packet('K', Buffer.concat([i32(1), i32(2)])), ready]));
          continue;
        }
        switch (String.fromCharCode(frame[0])) {
          case 'P':
            startQuery();
            command = frame.toString('utf8', frame.indexOf(0, 5) + 1).trim().split(/[\s\0]/)[0].toUpperCase();
            replies.push(packet('1'));
            break;
          case 'D': replies.push(packet('t', i16(0)), command === 'SELECT' ? rowDescription : packet('n')); break;
          case 'B': replies.push(packet('2')); break;
          case 'E':
            if (command === 'SELECT') replies.push(packet('D', Buffer.concat([i16(1), i32(1), Buffer.from('1')])));
            replies.push(packet('C', Buffer.from((command === 'SELECT' ? 'SELECT 1' : command) + '\0')));
            break;
          case 'S': finishQuery(); break;
          case 'Q':
            startQuery();
            command = frame.toString('utf8', 5).trim().split(/[\s\0]/)[0].toUpperCase();
            replies.push(packet('C', Buffer.from(command + '\0')));
            finishQuery();
            break;
          case 'X': socket.end(); break;
          default: throw new Error('Unexpected fixture wire message');
        }
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as net.AddressInfo;
  const env = {
    DATABASE_URL: `postgres://fixture:fixture@127.0.0.1:${address.port}/fixture`,
    DB_POOL_MAX: max, DB_IDLE_TIMEOUT_SECONDS: 1, DB_MAX_LIFETIME_SECONDS: 900,
    DB_CONNECT_TIMEOUT_SECONDS: 2, DB_STATEMENT_TIMEOUT_MS: 12000,
  };
  const { sql } = loadFixtureModule('src/db/client.ts', {
    '../lib/env': { env }, './schema/index': {},
    'drizzle-orm/postgres-js': { drizzle: () => ({}) },
    postgres: (url: string, options: postgres.Options<{}>) => postgres(url, {
      ...options, fetch_types: false, // Fixture only has built-in int4, no catalog.
      ...(overridePipeline == null ? {} : { max_pipeline: overridePipeline }),
      ...(backpressure ? { socket: async () => {
        const socket = net.createConnection({ host: '127.0.0.1', port: address.port });
        await once(socket, 'connect');
        const write = socket.write;
        socket.write = function (...args: any[]) {
          const accepted = Reflect.apply(write, this, args);
          if (Buffer.isBuffer(args[0]) && args[0].length >= 1024) {
            pressuredWrites++;
            setImmediate(() => socket.emit('drain'));
            return false; // Bytes accepted; only the backpressure signal is forced.
          }
          return accepted;
        } as typeof socket.write;
        return socket;
      } } : {}),
    }),
  }) as { sql: postgres.Sql };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let completed = 0, timedOut = false;
  try {
    await sql`select 1 as n`;
    await Promise.race([
      (async () => {
        await Promise.all(Array.from({ length: 12 }, async () => {
          assert.equal((await sql`select 1 as n`)[0].n, 1); completed++;
        }));
        // A follow-up query represents heartbeat/persistence work sharing the pool.
        assert.equal((await sql`select 1 as n`)[0].n, 1);
        // BEGIN must reserve its connection even when no pipelining is allowed.
        // Whitespace makes the backpressure case write immediately (>1024 bytes).
        await sql.begin(backpressure ? ' '.repeat(2048) : '', async tx => {
          assert.equal((await tx`select 1 as n`)[0].n, 1);
        });
        await assert.rejects(sql.begin(async () => { throw Error('fixture rollback'); }), /fixture rollback/);
        assert.equal((await sql`select 1 as n`)[0].n, 1);
      })(),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('fixture deadline')), 1000); }),
    ]);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'fixture deadline') throw error;
    timedOut = true;
  } finally {
    clearTimeout(deadline);
    await sql.end({ timeout: 0 });
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  if (backpressure) assert.ok(pressuredWrites > 0, 'backpressure case must actually accept a large write and return false');
  return { maxOutstanding, completed, timedOut };
}

const old = await exercise(4, 1);
assert.equal(old.maxOutstanding, 2, 'negative control: max_pipeline=1 still sends two transactions');
assert.equal(old.timedOut, true, 'negative control reproduces swallowed replies and a stuck pool');
console.log('PASS negative control: old setting pipelines two transactions and stalls');
for (const max of [1, 4]) {
  const current = await exercise(max);
  assert.deepEqual(current, { maxOutstanding: 1, completed: 12, timedOut: false }, `application pool max=${max} must serialize each socket and complete all work`);
  console.log(`PASS application pool max=${max}: 12 concurrent reads and follow-up complete, one transaction per socket`);
}
assert.deepEqual(await exercise(4, undefined, true), { maxOutstanding: 1, completed: 12, timedOut: false });
console.log('PASS transaction reservation, rollback and pool reuse under accepted-write backpressure');

