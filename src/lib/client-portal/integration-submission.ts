// Pure helpers for the portal store-connect flow (spec 2026-07-08).
// Kept Hono-free so the guard-suite test can exercise them directly.

/**
 * Client attribution for portal store submissions. Admins keep the legacy
 * pass-through; everyone else is FORCED into their own client scope — a
 * spoofed body clientId can never attach a store to another client.
 */
export function resolveSubmittedClientId(args: {
  isAdmin: boolean;
  clientIds: number[];
  bodyClientId: number | null;
}): { ok: true; clientId: number | null } | { ok: false; status: 400 | 403; error: string } {
  if (args.isAdmin) return { ok: true, clientId: args.bodyClientId };
  if (!args.clientIds.length) {
    return { ok: false, status: 403, error: 'your account has no client scope' };
  }
  if (args.bodyClientId != null) {
    return args.clientIds.includes(args.bodyClientId)
      ? { ok: true, clientId: args.bodyClientId }
      : { ok: false, status: 403, error: 'client not in your scope' };
  }
  if (args.clientIds.length === 1) return { ok: true, clientId: args.clientIds[0]! };
  return { ok: false, status: 400, error: 'clientId required when your scope spans multiple clients' };
}

const VALIDATION_WINDOW_MS = 60_000;
const VALIDATION_MAX_ATTEMPTS = 5;
const validationAttempts = new Map<string, { count: number; windowStart: number }>();

/**
 * In-memory per-user limiter for the live credential check (5/min) so the
 * endpoint can't be used as a token-probing oracle. Same pattern as the
 * label-creation limiter in src/services/labels.ts.
 */
export function checkValidationRateLimit(userId: string, now: number = Date.now()): boolean {
  const entry = validationAttempts.get(userId);
  if (!entry || now - entry.windowStart >= VALIDATION_WINDOW_MS) {
    validationAttempts.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= VALIDATION_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}
