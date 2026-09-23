/** Request syntax only. Backend scope, eligibility and persistence remain authoritative. */
export type FormFieldErrors = Record<string, string>;
export const RETURN_REASON_MAX = 500;
export const RETURN_RECIPIENT_MAX = 120;
export const CREATE_ITEMS_MAX = 200;
const MAX_INTEGER = 2147483647; // inbound_items integer columns
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const blank = (value: unknown) => value == null || value === '';
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function returnQuantityError(value: unknown, orderedQuantity?: number): string | undefined {
  if (blank(value)) return;
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0) {
    return 'Enter a quantity of zero or more.';
  }
  if (orderedQuantity !== undefined && Number(value) > orderedQuantity) {
    return `Enter no more than the ordered quantity (${orderedQuantity}).`;
  }
}

export function validateReturnCreate(input: unknown): FormFieldErrors {
  const body = record(input);
  if (!body) return { form: 'Enter valid return details.' };
  const errors: FormFieldErrors = {};
  if (typeof body.orderId !== 'number' || !Number.isSafeInteger(body.orderId) || body.orderId <= 0) errors.orderId = 'Choose a valid order.';
  if (!text(body.reason)) errors.reason = 'A return reason is required';
  else if (text(body.reason).length > RETURN_REASON_MAX) errors.reason = 'Return reason must be 500 characters or fewer';
  // Legacy API callers may omit the recipient and use the backend default. The form sends it explicitly.
  if (body.returnRecipientName != null) {
    if (!text(body.returnRecipientName)) errors.returnRecipientName = 'Return recipient name is required';
    else if (text(body.returnRecipientName).length > RETURN_RECIPIENT_MAX) errors.returnRecipientName = 'Return recipient name must be 120 characters or fewer';
  }
  if (!Array.isArray(body.items) || !body.items.length) errors.items = 'At least one returned item with a positive quantity is required';
  else {
    if (body.items.length > CREATE_ITEMS_MAX) errors.items = `Use no more than ${CREATE_ITEMS_MAX} return lines.`;
    let selected = false;
    body.items.slice(0, CREATE_ITEMS_MAX).forEach((raw, i) => {
      const item = record(raw);
      if (!item) { errors[`items.${i}.quantity`] = 'Enter valid item details.'; return; }
      const quantityError = returnQuantityError(item.quantity);
      if (quantityError) errors[`items.${i}.quantity`] = quantityError;
      if (Number(item.quantity) > 0) {
        if (!text(item.sku)) errors[`items.${i}.quantity`] = 'This item needs a SKU or item name before it can be returned.';
        else selected = true;
      }
      if (item.sku != null && typeof item.sku !== 'string') errors[`items.${i}.quantity`] = 'Enter a valid SKU.';
      if (item.name != null && typeof item.name !== 'string') errors[`items.${i}.quantity`] = 'Enter a valid item name.';
    });
    if (!selected) errors.items = 'At least one returned item with a positive quantity is required';
  }
  return errors;
}

function inboundQuantityError(value: unknown): string | undefined {
  if (blank(value)) return;
  const qty = Number(value);
  if (!['number', 'string'].includes(typeof value) || !Number.isInteger(qty) || qty < 0 || qty > MAX_INTEGER) {
    return 'Enter a whole number from 0 to 2,147,483,647.';
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

export function validateInboundCreate(input: unknown): FormFieldErrors {
  const body = record(input);
  if (!body) return { form: 'Enter valid inbound details.' };
  const errors: FormFieldErrors = {};
  if (body.idempotencyKey != null && (typeof body.idempotencyKey !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.idempotencyKey))) {
    errors.form = 'This save request is invalid. Close and reopen the form.';
  }
  if (body.clientId != null && (typeof body.clientId !== 'number' || !Number.isInteger(body.clientId) || body.clientId <= 0 || body.clientId > MAX_INTEGER)) {
    errors.clientId = 'Choose a valid client.';
  }
  for (const field of ['reference', 'supplier', 'carrier', 'trackingNumber', 'notes']) {
    if (body[field] != null && typeof body[field] !== 'string') errors[field] = 'Enter text for this field.';
  }
  if (!blank(body.status) && (typeof body.status !== 'string' || !['expected', 'in_transit', 'received', 'cancelled'].includes(body.status))) errors.status = 'Choose a valid status.';
  if (!blank(body.expectedDate) && (typeof body.expectedDate !== 'string' || !validDate(body.expectedDate))) errors.expectedDate = 'Choose a valid expected date.';
  if (body.items != null && !Array.isArray(body.items)) errors.items = 'Enter valid item rows.';
  else if (Array.isArray(body.items)) {
    if (body.items.length > CREATE_ITEMS_MAX) errors.items = `Use no more than ${CREATE_ITEMS_MAX} item rows.`;
    body.items.slice(0, CREATE_ITEMS_MAX).forEach((raw, i) => {
      const item = record(raw);
      if (!item) { errors[`items.${i}.sku`] = 'Enter a SKU or item name.'; return; }
      for (const field of ['sku', 'name']) {
        if (item[field] != null && typeof item[field] !== 'string') errors[`items.${i}.${field}`] = 'Enter text for this field.';
      }
      for (const field of ['expectedQty', 'receivedQty']) {
        const error = inboundQuantityError(item[field]);
        if (error) errors[`items.${i}.${field}`] = error;
      }
      if (!text(item.sku) && !text(item.name) && (Number(item.expectedQty) > 0 || Number(item.receivedQty) > 0)) {
        errors[`items.${i}.sku`] = 'Enter a SKU or item name for this quantity.';
      }
    });
  }
  return errors;
}
