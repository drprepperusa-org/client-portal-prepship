/** Shared presentation contract. This does not change invoice values or exports. */
export const BILLING_COLUMN_SECTIONS = {
  summary: [
    ['period', 'Billing Period', true], ['client', 'Client', true],
    ['orders', 'Orders'], ['pickpack', 'Pick & Pack'], ['addl', 'Addl Units'],
    ['box', 'Box Charge'], ['shipping', 'Shipping'], ['customsDuties', 'Customs/Duties'],
    ['returnProcessing', 'Return Processing'], ['returnPostage', 'Return Postage'],
    ['storage', 'Storage'], ['fee', 'Fulfillment Fee'],
  ],
  lineItems: [
    ['date', 'Billing Date', true], ['order', 'Reference', true], ['rowType', 'Type'],
    ['destination', 'Destination'], ['sku', 'SKU(s)'], ['qty', 'Qty'],
    ['pickpack', 'Pick & Pack'], ['addl', 'Addl Units'], ['boxcost', 'Box Charge'],
    ['boxsize', 'Box Size'], ['shipping', 'Shipping'], ['customsDuties', 'Customs/Duties'],
    ['storage', 'Storage'], ['adjustment', 'Adjustment'], ['returnprocessing', 'Return Processing'],
    ['returnpostage', 'Return Postage'], ['returntotal', 'Return Total'],
    ['replacepostage', 'Replacement Postage'], ['replacepickpack', 'Replacement Pick & Pack'],
    ['fee', 'Fulfillment Fee'],
  ],
} as const;

export type BillingColumnSection = keyof typeof BILLING_COLUMN_SECTIONS;
export type BillingColumnSelection = Record<BillingColumnSection, string[]>;
export type BillingColumnSettings = BillingColumnSelection & { revision: string | null; canManage: boolean };
export type BillingColumnUpdate = BillingColumnSelection & { revision: string | null };
