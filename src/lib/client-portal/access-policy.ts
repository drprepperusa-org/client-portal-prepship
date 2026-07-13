export type PortalAccessBoundary = {
  clientIds: number[];
  storeIds: number[];
};

export type PortalAccessTarget = PortalAccessBoundary & {
  isGlobal: boolean;
  isClientUser: boolean;
};

function isSubset(values: number[], allowed: number[]): boolean {
  const allowedIds = new Set(allowed);
  return values.every((value) => allowedIds.has(value));
}

export function isAccessAssignmentWithinBoundary(
  assignment: PortalAccessBoundary,
  boundary: PortalAccessBoundary,
): boolean {
  return (
    isSubset(assignment.clientIds, boundary.clientIds) &&
    isSubset(assignment.storeIds, boundary.storeIds)
  );
}

export function canManageAccessTarget(
  actor: { isGlobal: boolean; canManageUsers: boolean },
  target: PortalAccessTarget,
  boundary: PortalAccessBoundary,
): boolean {
  if (!actor.canManageUsers) return false;
  if (actor.isGlobal) return true;
  return target.isClientUser && !target.isGlobal && isAccessAssignmentWithinBoundary(target, boundary);
}
