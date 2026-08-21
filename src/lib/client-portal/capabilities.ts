import type { ClientPortalScope } from './scope';

export type ClientPortalCapabilities = {
  canManageUsers: boolean;
  canManageAdmins: boolean;
  canViewAudit: boolean;
  canReceiveInventory: boolean;
  canInspectReturns: boolean;
  /** CP-061: may request a replacement (forwarded to canonical PrepShip). */
  canRequestReplacements: boolean;
};

export function clientPortalCapabilities(
  scope: Pick<ClientPortalScope, 'isGlobal' | 'permissions'>,
): ClientPortalCapabilities {
  return {
    canManageUsers: scope.isGlobal || scope.permissions.includes('users:manage'),
    canManageAdmins: scope.isGlobal,
    canViewAudit: scope.isGlobal,
    canReceiveInventory: scope.isGlobal || scope.permissions.includes('settings:write'),
    canInspectReturns: scope.isGlobal || scope.permissions.includes('settings:write'),
    // CP-061 — minted here as the frozen name for PS-502 to adopt.
    canRequestReplacements: scope.isGlobal || scope.permissions.includes('replacements:request'),
  };
}
