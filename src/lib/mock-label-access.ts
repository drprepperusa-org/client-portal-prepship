import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';

const MOCK_LABEL_TTL_MS = 15 * 60 * 1000;

function signaturePayload(shipmentId: number, expiresAt: number): string {
  return `${shipmentId}.${expiresAt}`;
}

function sign(shipmentId: number, expiresAt: number): string {
  return createHmac('sha256', env.SUPABASE_JWT_SECRET)
    .update(signaturePayload(shipmentId, expiresAt))
    .digest('base64url');
}

export function addMockLabelSignature(url: string, shipmentId: number): string {
  const expiresAt = Date.now() + MOCK_LABEL_TTL_MS;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}exp=${expiresAt}&sig=${sign(shipmentId, expiresAt)}`;
}

export function refreshMockLabelSignature(url: string | null): string | null {
  if (!url) return url;

  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(url);
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://mock-label.local');
  } catch {
    return url;
  }

  const match = parsed.pathname.match(/\/labels\/mock\/(-?\d+)\/?$/);
  if (!match) return url;
  const shipmentId = Number(match[1]);
  if (!Number.isSafeInteger(shipmentId)) return url;

  parsed.searchParams.delete('exp');
  parsed.searchParams.delete('sig');
  const unsignedUrl = absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  return addMockLabelSignature(unsignedUrl, shipmentId);
}

export function verifyMockLabelSignature(
  shipmentId: number,
  expiresAtRaw: string | undefined,
  signature: string | undefined
): boolean {
  if (env.NODE_ENV !== 'production' && !expiresAtRaw && !signature) return true;
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = sign(shipmentId, expiresAt);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
