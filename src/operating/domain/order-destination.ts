export interface DestinationLocation {
  name: string;
  type: string;
  pointNames: string[];
}

export interface DestinationLocationType {
  name: string;
  allowedOperations: string[];
}

/** MOVE/NOP address a bare Point directly — no Location involved. */
const POINT_OPERATIONS = new Set(['MOVE', 'NOP']);

/**
 * The manual-order UI only ever deals in points and the action the operator wants performed
 * there — never a kernel Location name. This resolves what the kernel's transport-order API
 * actually needs: for MOVE/NOP, the point name itself; for a real action, the Location linked to
 * that point whose LocationType supports it. `name` may already be a real Location name (a caller
 * bypassing the point-based UI) — passed through unchanged when it matches one exactly.
 *
 * Returns `null` when a real action was requested but no Location at that point supports it —
 * the caller decides how to surface that (a 400, typically).
 */
export function resolveOrderDestination(
  name: string,
  operation: string,
  locations: readonly DestinationLocation[],
  locationTypes: readonly DestinationLocationType[],
): string | null {
  if (POINT_OPERATIONS.has(operation)) return name;
  if (locations.some((location) => location.name === name)) return name;

  const allowedByType = new Map(
    locationTypes.map((type) => [type.name, type.allowedOperations]),
  );
  const candidate = locations.find(
    (location) =>
      location.pointNames.includes(name) &&
      (allowedByType.get(location.type) ?? []).includes(operation),
  );
  return candidate?.name ?? null;
}
