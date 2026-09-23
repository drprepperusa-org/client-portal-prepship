import { useId, useRef, useState } from 'react';
import type { FormFieldErrors } from '@client-portal-contracts/create-form-validation';
import type { ApiError } from '@/lib/api/transport';

/** Presentation of shared request checks and additive, server-owned field errors. */
export function useFieldValidation(localErrors: FormFieldErrors) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<FormFieldErrors>({});
  const [serverMessage, setServerMessage] = useState('');
  const errors = { ...Object.fromEntries(Object.entries(localErrors).filter(([field]) => attempted || touched[field])), ...serverErrors };
  const message = serverMessage || (attempted && (Object.keys(localErrors).length || Object.keys(serverErrors).length) ? 'Check the highlighted fields before saving.' : '');
  const errorId = (field: string) => `${id}-${field}-error`;

  function focusError() {
    requestAnimationFrame(() => {
      const invalid = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      const target = invalid?.matches('input,select,textarea,button') ? invalid :
        invalid?.querySelector<HTMLElement>('input[aria-invalid="true"],select[aria-invalid="true"],textarea[aria-invalid="true"],button[aria-invalid="true"]') ??
        invalid?.querySelector<HTMLElement>('input,select,textarea,button');
      (target ?? ref.current?.querySelector<HTMLElement>('[data-validation-summary]'))?.focus();
    });
  }

  function nativeNumberErrors() {
    const fields: FormFieldErrors = {};
    ref.current?.querySelectorAll<HTMLInputElement>('input[type="number"][data-form-field]').forEach(input => {
      // Browsers report unfinished numeric input (e.g. "e") as value="". It is not an intentional blank/zero.
      if (input.validity.badInput) fields[input.dataset.formField!] = 'Enter a valid number.';
    });
    return fields;
  }

  function check() {
    setAttempted(true);
    const nativeErrors = nativeNumberErrors();
    setServerErrors(nativeErrors);
    setServerMessage('');
    if (!Object.keys(localErrors).length && !Object.keys(nativeErrors).length) return true;
    focusError();
    return false;
  }

  function reject(error: unknown, itemIndices?: number[]) {
    const apiError = error as ApiError | undefined;
    const fields: FormFieldErrors = {};
    for (const [field, value] of Object.entries(apiError?.fieldErrors ?? {})) {
      const match = /^items\.(\d+)\.(.+)$/.exec(field);
      const mapped = match && itemIndices ? `items.${itemIndices[Number(match[1])] ?? match[1]}.${match[2]}` : field;
      fields[mapped] = value;
    }
    setAttempted(true);
    setServerErrors(fields);
    setServerMessage(apiError?.status && apiError.status < 500 && error instanceof Error ? error.message : 'Could not save. Please try again. Your entries are still here.');
    focusError();
  }

  function changed() {
    setServerErrors({});
    setServerMessage('');
  }

  function props(field: string) {
    return {
      'data-form-field': field,
      'aria-invalid': errors[field] ? true as const : undefined,
      'aria-describedby': errors[field] ? errorId(field) : undefined,
      onBlur: () => {
        setTouched(previous => ({ ...previous, [field]: true }));
        setServerErrors(previous => ({ ...previous, ...nativeNumberErrors() }));
      },
    };
  }

  return {
    ref, props, check, reject, changed,
    feedback: (field: string) => errors[field] ? <p id={errorId(field)} className="mt-1 text-xs text-rose-700">{errors[field]}</p> : null,
    summary: message ? <p data-validation-summary tabIndex={-1} role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 focus:outline-none">{message}</p> : null,
  };
}
