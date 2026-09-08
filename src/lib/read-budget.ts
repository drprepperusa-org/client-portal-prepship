/** Request-local admission for independent reads. Never use across transactions. */
export function createReadBudget(limit = 2) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function read<T>(work: () => PromiseLike<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
