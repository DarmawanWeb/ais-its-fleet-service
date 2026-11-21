import type { EngineKind } from '@darmawanweb/ais-its-contracts/domain';
import { describe, expect, it } from 'vitest';

import { engineAssignmentErrors } from './engine-assignment.js';

const MAIN = 'engine-main';
const AUX = 'engine-aux';
const kinds = new Map<string, EngineKind>([
  [MAIN, 'main'],
  [AUX, 'auxiliary'],
]);

describe('engineAssignmentErrors', () => {
  it('accepts one main row and auxiliary rows with quantities', () => {
    expect(
      engineAssignmentErrors(
        [
          { engineId: MAIN, role: 'main', quantity: 2 },
          { engineId: AUX, role: 'auxiliary', quantity: 2 },
        ],
        kinds,
      ),
    ).toEqual([]);
    expect(engineAssignmentErrors([], kinds)).toEqual([]);
  });

  it('reports unknown engines, role mismatches, duplicates and several main rows', () => {
    const codes = engineAssignmentErrors(
      [
        { engineId: 'missing', role: 'main', quantity: 1 },
        { engineId: AUX, role: 'main', quantity: 1 },
        { engineId: MAIN, role: 'main', quantity: 1 },
        { engineId: MAIN, role: 'main', quantity: 1 },
      ],
      kinds,
    ).map((error) => `${error.field}:${error.code ?? ''}`);
    expect(codes).toEqual([
      '0.engineId:engineNotFound',
      '1.role:engineRoleMismatch',
      '3.engineId:duplicateEngine',
      'role:multipleMainEngines',
    ]);
  });
});
