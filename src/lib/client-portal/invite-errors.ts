type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

function normalizedText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isExistingInviteAccountError(error: unknown): boolean {
  const authError = (error ?? {}) as AuthErrorLike;
  const code = normalizedText(authError.code).toLowerCase();
  const message = normalizedText(authError.message).toLowerCase();
  return (
    /user_already_exists|email_exists|email_address_exists/.test(code) ||
    /\b(already registered|already exists|user already)\b/.test(message)
  );
}

export function inviteErrorDiagnostic(error: unknown): Record<string, string | number> {
  const authError = (error ?? {}) as AuthErrorLike;
  const diagnostic: Record<string, string | number> = {};
  const status = authError.status;
  const code = normalizedText(authError.code);
  const name = normalizedText(authError.name);
  const message = normalizedText(authError.message);

  if (typeof status === 'number') diagnostic.status = status;
  if (code) diagnostic.code = code;
  if (name) diagnostic.name = name;
  if (message) diagnostic.message = message;
  return diagnostic;
}
