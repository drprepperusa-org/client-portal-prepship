import assert from 'node:assert/strict';
import {
  renameStoreCredentialAccount,
  type SqlLike,
} from '../src/services/credential-accounts';

type QueryCall = {
  text: string;
  values: unknown[];
};

function mockSql(accountExists: boolean): { sql: SqlLike; calls: QueryCall[]; began: () => boolean } {
  const calls: QueryCall[] = [];
  let transactionStarted = false;

  const executor = (async (
    stringsOrIdentifier: TemplateStringsArray | string,
    ...values: unknown[]
  ): Promise<unknown> => {
    if (typeof stringsOrIdentifier === 'string') return stringsOrIdentifier;
    const text = stringsOrIdentifier.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });

    if (text.startsWith('UPDATE store_accounts')) {
      return accountExists
        ? [{
            id: 42,
            clientId: 7,
            provider: 'shopify',
            label: values[0],
            accountIdentifier: 'example.myshopify.com',
            source: 'admin',
            active: true,
          }]
        : [];
    }
    if (text.startsWith('SELECT id FROM clients')) return [{ id: 99 }];
    if (text.startsWith('UPDATE clients')) return [];
    throw new Error(`Unexpected query: ${text}`);
  }) as SqlLike;

  executor.unsafe = async () => [];
  executor.begin = async (run) => {
    transactionStarted = true;
    await run(executor);
  };

  return { sql: executor, calls, began: () => transactionStarted };
}

{
  const database = mockSql(true);
  const renamed = await renameStoreCredentialAccount(database.sql, 42, 'Shopify - Chris');

  assert.equal(database.began(), true, 'rename runs in one transaction');
  assert.equal(renamed?.label, 'Shopify - Chris');

  const accountUpdate = database.calls.find((call) => call.text.startsWith('UPDATE store_accounts'));
  assert.deepEqual(accountUpdate?.values, ['Shopify - Chris', 42]);

  const clientUpdate = database.calls.find((call) => call.text.startsWith('UPDATE clients'));
  assert.deepEqual(
    clientUpdate?.values,
    ['Shopify - Chris', 9_200_042],
    'PrepShip client name mirrors the canonical connection label for the synthetic store',
  );
}

{
  const database = mockSql(false);
  const renamed = await renameStoreCredentialAccount(database.sql, 404, 'Missing');

  assert.equal(renamed, null);
  assert.equal(
    database.calls.some((call) => call.text.startsWith('UPDATE clients')),
    false,
    'missing store accounts cannot rename a PrepShip client',
  );
}

console.log('PASS store account rename keeps the PrepShip client display name synchronized');
