import { type PrintQueueEntry } from '../db/schema/print-queue';
import { extractShipstationLabelUrl } from '../lib/shipstation/labels';

/** Label-URL validation + fetch-URL resolution (extracted from print-queue.ts). */

export class PrintQueueLabelUrlError extends Error {
  status = 400 as const;
  code = 'INVALID_LABEL_URL' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PrintQueueLabelUrlError';
  }
}

export function isPrintQueueLabelUrlError(err: unknown): err is PrintQueueLabelUrlError {
  return err instanceof PrintQueueLabelUrlError;
}

// Per user override unlock shipped data on 2026-05-23: shipped-label queue
// handling unwraps known provider label URL objects while still rejecting empty/corrupt values.
export function normalizePrintQueueLabelUrl(labelUrl: unknown): string {
  const normalized = typeof labelUrl === 'string'
    ? labelUrl
    : extractShipstationLabelUrl(labelUrl);
  if (typeof normalized !== 'string') {
    throw new PrintQueueLabelUrlError('Label URL must resolve to a string.');
  }
  const trimmed = normalized.trim();
  if (trimmed.length === 0) {
    throw new PrintQueueLabelUrlError('Label URL is required.');
  }
  if (trimmed === '[object Object]') {
    throw new PrintQueueLabelUrlError('Label URL is invalid. Re-create the label and try again.');
  }
  return trimmed;
}

export function formatLabelUrlError(entry: PrintQueueEntry, err: unknown): string {
  const orderRef = entry.orderNumber ?? entry.orderId;
  const message = isPrintQueueLabelUrlError(err)
    ? err.message
    : err instanceof Error
      ? err.message
      : 'Invalid label URL.';
  return `Invalid label URL for order ${orderRef}: ${message}`;
}

export function collectInvalidLabelErrors(entries: PrintQueueEntry[]): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    try {
      normalizePrintQueueLabelUrl(entry.labelUrl);
    } catch (err) {
      errors.push(formatLabelUrlError(entry, err));
    }
  }
  return errors;
}

export function resolveApiOrigin(requestOrigin?: string): string {
  const candidates = [
    requestOrigin,
    process.env.PUBLIC_API_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.API_BASE_URL,
    process.env.VITE_API_URL,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
    } catch {
      // Try the next configured origin.
    }
  }
  return `http://localhost:${process.env.PORT || '3000'}`;
}

export function resolveLabelFetchUrl(labelUrl: unknown, requestOrigin?: string): string {
  const trimmed = normalizePrintQueueLabelUrl(labelUrl);
  try {
    return new URL(trimmed).toString();
  } catch {
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return new URL(path, resolveApiOrigin(requestOrigin)).toString();
  }
}

export function isMockLabelUrl(labelUrl: unknown): boolean {
  if (typeof labelUrl !== 'string') return false;
  return /(?:^|\/)(?:api\/)?labels\/mock\/-?\d+(?:$|[?#/])/.test(labelUrl);
}
