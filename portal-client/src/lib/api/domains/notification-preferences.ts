import type { PortalNotificationPreferences } from '@client-portal-contracts/notification-preferences';
import { apiGet, apiPut, type RequestAuth } from '../transport';

const path = '/api/client-portal/notification-preferences';
export const notificationPreferencesApi = {
  notificationPreferences: (token: RequestAuth) => apiGet<PortalNotificationPreferences>(token, path),
  saveNotificationPreferences: (token: RequestAuth, preferences: PortalNotificationPreferences) =>
    apiPut<PortalNotificationPreferences>(token, path, preferences),
};
