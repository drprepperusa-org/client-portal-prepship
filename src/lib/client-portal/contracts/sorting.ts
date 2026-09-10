/** Public sort intent; never a SQL identifier supplied by a caller. */
export interface SortOptions {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/** Existing UI column identities map to the canonical PrepShip billing fields. */
export const INVOICE_SORT_FIELDS: Readonly<Record<string, string>> = {
  date: 'billingEffectiveDate', order: 'displayReference', rowType: 'rowType',
  destination: 'destination', sku: 'itemSkus', qty: 'qty', pickpack: 'pickpackTotal',
  addl: 'additionalTotal', boxcost: 'packageTotal', boxsize: 'boxSize',
  shipping: 'shippingTotal', storage: 'storageTotal', adjustment: 'adjustmentTotal',
  returnprocessing: 'returnProcessingTotal', returnpostage: 'returnPostageTotal',
  returntotal: 'returnTotal', replacepostage: 'replacePostageTotal',
  replacepickpack: 'replacePickPackTotal', fee: 'grandTotal',
};
