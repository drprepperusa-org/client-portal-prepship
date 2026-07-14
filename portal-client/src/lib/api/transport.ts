const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const API_BASE = import.meta.env.DEV ? '' : (configured ?? '').replace(/\/+$/, '');

const TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 120000;

export type QueryValue = string | number | boolean | null | undefined;
export type ApiError = Error & { status?: number };

function queryString(params: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

async function request(
  token: string,
  path: string,
  params: Record<string, QueryValue>,
  accept: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}${queryString(params)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function fail(response: Response): Promise<never> {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // Keep the status-derived message when the response is not JSON.
  }
  const error = new Error(message) as ApiError;
  error.status = response.status;
  throw error;
}

export async function apiGet<T>(
  token: string,
  path: string,
  params: Record<string, QueryValue> = {},
): Promise<T> {
  const response = await request(token, path, params, 'application/json');
  if (!response.ok) await fail(response);
  return (await response.json()) as T;
}

export async function apiText(
  token: string,
  path: string,
  params: Record<string, QueryValue> = {},
): Promise<string> {
  const response = await request(token, path, params, 'text/html,application/pdf,text/plain,*/*');
  if (!response.ok) await fail(response);
  return response.text();
}

async function apiSend<T>(method: string, token: string, path: string, body: unknown = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) await fail(response);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export const apiPost = <T>(token: string, path: string, body: unknown = {}) =>
  apiSend<T>('POST', token, path, body);
export const apiPatch = <T>(token: string, path: string, body: unknown = {}) =>
  apiSend<T>('PATCH', token, path, body);
export const apiPut = <T>(token: string, path: string, body: unknown = {}) =>
  apiSend<T>('PUT', token, path, body);
export const apiDelete = <T>(token: string, path: string, body: unknown = {}) =>
  apiSend<T>('DELETE', token, path, body);

export async function apiUpload<T>(token: string, path: string, form: FormData): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) await fail(response);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}
