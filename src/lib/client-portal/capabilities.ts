import type { ClientPortalScope } from './scope';

export type ClientPortalCapabilities = {
  canManageUsers: boolean;
  canManageAdmins: boolean;
  canViewAudit: boolean;
  canReceiveInventory: boolean;
};

export function clientPortalCapabilities(
  scope: Pick<ClientPortalScope, 'isGlobal' | 'permissions'>,
): ClientPortalCapabilities {
  return {
    canManageUsers: scope.isGlobal || scope.permissions.includes('users:manage'),
    canManageAdmins: scope.isGlobal,
    canViewAudit: scope.isGlobal,
    canReceiveInventory: scope.isGlobal || scope.permissions.includes('settings:write'),
  };
}
