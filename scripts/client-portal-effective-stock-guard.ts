// PS-378 compatibility gate: PS-439 removed effective-stock and cache fallbacks.
await import('./ps-439-inventory-source-of-truth-guard.js');
console.log('PASS PS-378 compatibility guard via PS-439 inventoryQuantity');
