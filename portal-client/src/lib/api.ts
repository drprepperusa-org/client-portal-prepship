/**
 * Compatibility facade for the active Client Portal API.
 *
 * Transport, request scoping, and endpoint groups live under ./api/. Public
 * DTO types come from the backend-owned versioned contracts, so frontend and
 * backend cannot drift through parallel interface edits.
 */
export { portalApi } from './api/client';
export {
  API_BASE,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiText,
  apiUpload,
} from './api/transport';
export type { ApiError, QueryValue } from './api/transport';
export type * from '@client-portal-contracts/index';
