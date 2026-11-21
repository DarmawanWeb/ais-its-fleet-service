import type {
  AuxEngineSnapshot,
  VesselDeletedV1,
  VesselSnapshotV1,
} from '@darmawanweb/ais-its-contracts/events';

import type { Engine, VesselAggregate, VesselRecord } from './vessel.js';

function auxEngineSnapshot(engine: Engine): AuxEngineSnapshot {
  return {
    id: engine.id,
    name: engine.name,
    rpm: engine.rpm,
    powerKw: engine.powerKw,
    sfoc: engine.sfoc,
  };
}

/**
 * Builds the `fleet.vessel.upserted.v1` payload (VesselSnapshotV1, spec §7.4)
 * of a vessel aggregate.
 *
 * Engines follow the legacy `Ship.engineSpecs` shape the consumers were
 * ported from: `mainEngine` is the single main-engine row with its count
 * (`quantity`); `auxEngines` lists **one entry per physical auxiliary
 * engine** (a row with quantity 2 appears twice, exactly like the legacy
 * Postman sample `engine: [D2866LE, D2866LE]`) and `auxEngineQuantity` is
 * their number, so the legacy SEEMP term `auxEngines[0].powerKw ×
 * auxEngineQuantity` keeps its meaning. `type.capacityFixed` carries the
 * regulation-fixed capacity of the size band (`null` when the vessel's own
 * capacity applies). `updatedAt` is the vessel's `updated_at`, which every
 * change of the vessel or of reference data it embeds advances, so consumers
 * can keep the newest snapshot by comparing it.
 */
export function toVesselSnapshot(aggregate: VesselAggregate): VesselSnapshotV1 {
  const { vessel, dimensions, type, fuel, firstFuelFormula, engines } =
    aggregate;
  const main = engines.find((fitted) => fitted.role === 'main');
  const auxEngines = engines
    .filter((fitted) => fitted.role === 'auxiliary')
    .flatMap((fitted) =>
      Array.from({ length: fitted.quantity }, () =>
        auxEngineSnapshot(fitted.engine),
      ),
    );
  return {
    id: vessel.id,
    orgId: vessel.orgId,
    mmsi: vessel.mmsi,
    imo: vessel.imo,
    name: vessel.name,
    flag: vessel.flag,
    builtYear: vessel.builtYear,
    status: vessel.status,
    annualVoyagePercentage: vessel.annualVoyagePercentage,
    dimensions: {
      capacity: dimensions.capacity,
      dwt: dimensions.dwt,
      gt: dimensions.gt,
      cb: dimensions.cb,
      lwl: dimensions.lwl,
      b: dimensions.b,
      t: dimensions.t,
      cwp: dimensions.cwp,
      loa: dimensions.loa,
      lpp: dimensions.lpp,
      cp: dimensions.cp,
      cm: dimensions.cm,
      cbnsp: dimensions.cbnsp,
      bulbousBow: dimensions.bulbousBow,
      cstern: dimensions.cstern,
      c1: dimensions.c1,
      c2: dimensions.c2,
      c3: dimensions.c3,
      c5: dimensions.c5,
      vs: dimensions.vs,
    },
    type: {
      id: type.id,
      code: type.code,
      name: type.name,
      capacityUnit: type.capacityUnit,
      a: type.a,
      c: type.c,
      capacityFixed: type.capacityFixed,
      d: { d1: type.d1, d2: type.d2, d3: type.d3, d4: type.d4 },
    },
    fuel: {
      id: fuel.id,
      code: fuel.code,
      name: fuel.name,
      carbonContent: fuel.carbonContent,
      conversionFactor: fuel.conversionFactor,
      density: fuel.density,
    },
    mainEngine:
      main === undefined
        ? null
        : { ...auxEngineSnapshot(main.engine), quantity: main.quantity },
    auxEngines,
    auxEngineQuantity: auxEngines.length,
    firstFuelFormula:
      firstFuelFormula === null
        ? null
        : {
            id: firstFuelFormula.id,
            mainEngineFormula: firstFuelFormula.mainEngineFormula,
            auxiliaryEngineFormula: firstFuelFormula.auxiliaryEngineFormula,
          },
    portIds: [...aggregate.portIds],
    // Writers bump vessels.updated_at with clock_timestamp() on every change,
    // reference-data cascades included: strictly increasing per vessel.
    updatedAt: vessel.updatedAt.toISOString(),
  };
}

/** The `fleet.vessel.deleted.v1` payload (tombstone) of a deleted vessel. */
export function toVesselDeleted(
  vessel: Pick<VesselRecord, 'id' | 'mmsi' | 'orgId'>,
): VesselDeletedV1 {
  return { id: vessel.id, mmsi: vessel.mmsi, orgId: vessel.orgId };
}
