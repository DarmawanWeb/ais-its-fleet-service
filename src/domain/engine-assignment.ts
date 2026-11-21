import type { FieldError } from '@darmawanweb/ais-its-contracts/api';
import type { EngineKind } from '@darmawanweb/ais-its-contracts/domain';

/** One engine of `PUT /vessels/:id/engines`. */
export interface EngineAssignment {
  readonly engineId: string;
  readonly role: EngineKind;
  /** Number of identical engines (≥ 1). */
  readonly quantity: number;
}

/**
 * Checks the engines fitted to a vessel against the catalogue (the shape of
 * VesselSnapshotV1, spec §7.4): every engine exists and its catalogue kind
 * equals its role, an engine appears once per role (use `quantity` for
 * identical engines), and there is at most one main-engine row.
 *
 * @param assignments - the request, in order
 * @param kinds - catalogue kind of each known engine id
 * @returns one field error per violation (`[]` when valid), with paths
 *   `<index>.engineId` / `<index>.role` as the validation pipe reports them
 */
export function engineAssignmentErrors(
  assignments: readonly EngineAssignment[],
  kinds: ReadonlyMap<string, EngineKind>,
): FieldError[] {
  const errors: FieldError[] = [];
  const seen = new Set<string>();
  let mainRows = 0;
  assignments.forEach((assignment, index) => {
    const kind = kinds.get(assignment.engineId);
    if (kind === undefined) {
      errors.push({
        field: `${index}.engineId`,
        message: `No engine with id ${assignment.engineId}`,
        code: 'engineNotFound',
      });
    } else if (kind !== assignment.role) {
      errors.push({
        field: `${index}.role`,
        message: `Engine ${assignment.engineId} is a ${kind} engine, not ${assignment.role}`,
        code: 'engineRoleMismatch',
      });
    }
    const key = `${assignment.role}:${assignment.engineId}`;
    if (seen.has(key)) {
      errors.push({
        field: `${index}.engineId`,
        message: 'Engine listed twice for the same role: use quantity',
        code: 'duplicateEngine',
      });
    }
    seen.add(key);
    if (assignment.role === 'main') mainRows += 1;
  });
  if (mainRows > 1) {
    errors.push({
      field: 'role',
      message:
        'At most one main-engine row (several identical main engines: quantity)',
      code: 'multipleMainEngines',
    });
  }
  return errors;
}
