import type { FormFieldErrors } from './create-form-validation';

/** Request syntax only; shipment membership, scope and status belong to the backend. */
export function validateInboundReceive(input: unknown): FormFieldErrors {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { form: 'Enter valid receiving details.' };
  const body = input as Record<string, unknown>;
  const errors: FormFieldErrors = {};
  if (typeof body.addToInventory !== 'boolean') errors.addToInventory = 'Choose whether to add the received units to inventory.';
  if (!Array.isArray(body.items)) return { ...errors, items: 'Enter a received quantity for every item.' };
  const ids = new Set<number>();
  body.items.forEach((raw: unknown, index: number) => {
    const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const key = `items.${index}.receivedQty`;
    if (typeof item.id !== 'number' || !Number.isInteger(item.id) || item.id <= 0 || item.id > 2147483647 || ids.has(item.id)) {
      errors[key] = 'This item is invalid or repeated. Close and reopen the shipment.';
    } else ids.add(item.id);
    const value = item.receivedQty;
    if (value == null || (typeof value === 'string' && !value.trim())) errors[key] = 'Enter the received quantity. Use 0 if none arrived.';
    else if (!['number', 'string'].includes(typeof value) || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 2147483647) {
      errors[key] = 'Enter a whole number from 0 to 2,147,483,647.';
    }
  });
  return errors;
}
