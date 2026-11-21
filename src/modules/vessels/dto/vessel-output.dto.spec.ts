import { describe, expect, it } from 'vitest';

import { sampleAggregate } from '../../../../test/fixtures/sample-vessel.js';
import type { VesselView } from '../vessel-view.js';
import {
  toVesselDto,
  VesselDetailDto,
  VesselSummaryDto,
} from './vessel-output.dto.js';

const aggregate = sampleAggregate();
const identity = {
  vessel: aggregate.vessel,
  type: {
    id: aggregate.type.id,
    code: aggregate.type.code,
    name: aggregate.type.name,
    icon: aggregate.type.icon,
  },
  photoUrl:
    'https://s3.example/vessel-photos/vessels/x/y.jpg?X-Amz-Signature=…',
};

/** Technical fields that must never reach another tenant (spec §8.5). */
const TECHNICAL_FIELDS = [
  'orgId',
  'dimensions',
  'fuel',
  'engines',
  'firstFuelFormula',
  'ports',
  'annualVoyagePercentage',
  'builtYear',
  'legacyId',
];

describe('toVesselDto (tenancy DTO selection)', () => {
  it('returns identity fields only for the summary view', () => {
    const dto = toVesselDto({ view: 'summary', identity });
    expect(dto).toBeInstanceOf(VesselSummaryDto);
    expect(dto).not.toBeInstanceOf(VesselDetailDto);
    expect(JSON.parse(JSON.stringify(dto))).toEqual({
      view: 'summary',
      id: aggregate.vessel.id,
      mmsi: 525005223,
      imo: '9037941',
      name: 'Dharma Ferry VIII',
      flag: 'ID',
      type: {
        id: aggregate.type.id,
        code: 'roro_passenger',
        name: 'Ro-ro passenger ship',
        icon: 'ro-rop',
      },
      status: 'active',
      photoUrl: identity.photoUrl,
      updatedAt: '2026-03-01T12:00:00.000Z',
    });
    for (const field of TECHNICAL_FIELDS) expect(dto).not.toHaveProperty(field);
  });

  it('adds the technical data for the detail view', () => {
    const view: VesselView = {
      view: 'detail',
      identity,
      aggregate,
      ports: [
        { id: aggregate.portIds[0] ?? '', code: 'PBI', name: 'Padang Bai' },
      ],
    };
    const dto = toVesselDto(view);
    expect(dto).toBeInstanceOf(VesselDetailDto);
    expect(dto).toMatchObject({
      view: 'detail',
      orgId: aggregate.vessel.orgId,
      annualVoyagePercentage: 41.6666666666667,
      dimensions: { capacity: 2877, bulbousBow: false, cstern: 8 },
      type: {
        code: 'roro_passenger',
        a: 2023,
        c: 0.46,
        d: { d1: 0.76, d4: 1.3 },
      },
      fuel: { code: 'diesel_gas_oil', conversionFactor: 3.206 },
      engines: [
        { role: 'main', quantity: 2, engine: { name: 'NIIGATA 6M28BET' } },
        { role: 'auxiliary', quantity: 2, engine: { name: 'MAN D2866LE' } },
      ],
      firstFuelFormula: { code: 'dharma_ferry_viii' },
      ports: [{ code: 'PBI' }],
      legacyId: '683ab0e288e28cca4c61173a',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
