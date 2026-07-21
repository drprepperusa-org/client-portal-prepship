// Retired by PS-439. The former probe mutated a live inventory row and then
// deleted its ledger evidence. Inventory verification now runs only through
// offline integration fixtures and the immutable source-of-truth guard.
throw new Error(
  'PS439_INVENTORY_LEDGER_IMMUTABLE: run npm run test:ps-439-inventory-sot instead of this live mutation probe',
);
