import { randomUUID } from 'node:crypto';

import { newId } from '@darmawanweb/ais-its-contracts/domain';
import {
  EVENT_TYPES,
  parseEnvelope,
  SUBJECT_FILTERS,
  subjects,
  type VesselSnapshotV1,
} from '@darmawanweb/ais-its-contracts/events';
import { PG_POOL, type Pool } from '@darmawanweb/ais-its-nest/db';
import {
  enqueueEvent,
  EventPublisher,
  NatsClient,
  OutboxRelay,
} from '@darmawanweb/ais-its-nest/nats';
import { waitFor } from '@darmawanweb/ais-its-nest/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FleetDb } from '../src/db/database.js';
import * as schema from '../src/db/schema.js';
import { VesselAggregatesRepository } from '../src/modules/snapshots/vessel-aggregates.repository.js';
import { SAMPLE_DIMENSIONS } from './fixtures/sample-vessel.js';
import {
  bodyOf,
  createReference,
  createReferenceSet,
  createVessel,
  problemOf,
  type ReferenceSet,
  uniqueCode,
  uniqueMmsi,
} from './support/fleet-fixtures.js';
import {
  FleetStreamProbe,
  lastStoredFleetMessage,
  type ReceivedFleetEvent,
} from './support/fleet-stream.js';
import {
  newOrganization,
  SUPER_ADMIN,
  startTestService,
  type TestService,
} from './support/test-service.js';

/** The snapshot entry of the test auxiliary engine. */
const AUX_ENGINE_SNAPSHOT = (references: ReferenceSet) => ({
  id: references.auxEngineId,
  name: 'MAN D2866LE (test)',
  rpm: 1800,
  powerKw: 276,
  sfoc: 207,
});

const isUpsert = (event: ReceivedFleetEvent): boolean =>
  event.envelope.type === EVENT_TYPES.FLEET_VESSEL_UPSERTED;

/** The snapshot payload of an upsert event (typed loosely for assertions). */
function snapshotOf(event: ReceivedFleetEvent): Record<string, unknown> & {
  updatedAt: string;
} {
  expect(event.envelope.type).toBe(EVENT_TYPES.FLEET_VESSEL_UPSERTED);
  return event.envelope.data as Record<string, unknown> & { updatedAt: string };
}

interface OutboxRecord {
  id: string;
  type: string;
  entity_key: string | null;
  attempts: number;
  published_at: Date | null;
  failed_at: Date | null;
  last_error: string | null;
  next_attempt_at: Date;
}

describe('VesselSnapshotV1 publication through the transactional outbox', () => {
  let service: TestService;
  let pool: Pool;
  let probe: FleetStreamProbe;
  let references: ReferenceSet;
  const org = newOrganization();

  const outboxRow = async (id: string): Promise<OutboxRecord | undefined> => {
    const { rows } = await pool.query<OutboxRecord>(
      'SELECT id, type, entity_key, attempts, published_at, failed_at, last_error, next_attempt_at FROM outbox WHERE id = $1',
      [id],
    );
    return rows[0];
  };

  beforeAll(async () => {
    service = await startTestService();
    pool = service.app.get<unknown, Pool>(PG_POOL);
    probe = await FleetStreamProbe.start(service.app);
    references = await createReferenceSet(service);
  });

  afterAll(async () => {
    await probe.stop();
    await service.app.close();
  });

  it('publishes the snapshot of a new vessel to fleet.vessel.v1.<id> with Nats-Msg-Id = outbox id', async () => {
    const vessel = await createVessel(service, org.admin, references);

    const event = await probe.next(vessel.id, isUpsert);
    expect(event.msgId).toBe(event.envelope.id);
    expect(event.envelope).toMatchObject({
      source: 'fleet',
      subject: vessel.id,
    });
    expect(snapshotOf(event)).toEqual({
      id: vessel.id,
      orgId: org.id,
      mmsi: vessel.mmsi,
      imo: vessel.imo,
      name: 'Dharma Ferry VIII',
      flag: 'ID',
      builtYear: 1990,
      status: 'active',
      annualVoyagePercentage: 41.6666666666667,
      dimensions: SAMPLE_DIMENSIONS,
      type: {
        id: references.typeId,
        code: references.typeCode,
        name: 'Ro-ro passenger ship (test)',
        capacityUnit: 'GT',
        a: 2023,
        c: 0.46,
        capacityFixed: null,
        d: { d1: 0.76, d2: 0.92, d3: 1.14, d4: 1.3 },
      },
      fuel: {
        id: references.fuelId,
        code: references.fuelCode,
        name: 'Diesel/Gas oil (test)',
        carbonContent: 0.8744,
        conversionFactor: 3.206,
        density: 0.86,
      },
      mainEngine: {
        id: references.mainEngineId,
        name: 'NIIGATA 6M28BET (test)',
        rpm: 390,
        powerKw: 2100,
        sfoc: 179.2,
        quantity: 2,
      },
      // One entry per physical auxiliary engine (legacy engineSpecs shape).
      auxEngines: [
        AUX_ENGINE_SNAPSHOT(references),
        AUX_ENGINE_SNAPSHOT(references),
      ],
      auxEngineQuantity: 2,
      firstFuelFormula: {
        id: references.formulaId,
        mainEngineFormula:
          '-0.0382 * speedKnot ** 2 + 0.8658 * speedKnot - 0.0197',
        auxiliaryEngineFormula: '1.5103 * Math.exp(-0.064 * speedKnot)',
      },
      portIds: [...references.portIds],
      updatedAt: vessel.updatedAt,
    });

    // The relay marked the row published; the stream holds it as the latest message.
    const row = await waitFor(
      async () => {
        const current = await outboxRow(event.envelope.id);
        return current?.published_at === null ? false : current;
      },
      { message: 'outbox row not marked published' },
    );
    expect(row).toMatchObject({
      type: EVENT_TYPES.FLEET_VESSEL_UPSERTED,
      entity_key: vessel.id,
    });
    const stored = await lastStoredFleetMessage(service.app, vessel.id);
    expect(stored?.msgId).toBe(event.envelope.id);
  });

  it('publishes every change of a vessel in commit order', async () => {
    const vessel = await createVessel(service, org.admin, references);
    const url = `/api/v2/vessels/${vessel.id}`;
    await probe.next(vessel.id, isUpsert);

    bodyOf(
      await service.request(org.admin, 'PATCH', url, { status: 'inactive' }),
      200,
    );
    bodyOf(
      await service.request(org.admin, 'PUT', `${url}/ports`, [
        references.portIds[1],
      ]),
      200,
    );
    bodyOf(
      await service.request(org.admin, 'PUT', `${url}/engines`, [
        { engineId: references.auxEngineId, role: 'auxiliary', quantity: 3 },
      ]),
      200,
    );
    const last = snapshotOf(
      await probe.next(
        vessel.id,
        (event) =>
          isUpsert(event) &&
          (event.envelope.data as { auxEngineQuantity: number })
            .auxEngineQuantity === 3,
      ),
    );
    expect(last).toMatchObject({
      status: 'inactive',
      portIds: [references.portIds[1]],
      mainEngine: null,
      auxEngineQuantity: 3,
    });
    // Snapshots of one vessel arrive in order, each newer than the previous one.
    const times = probe
      .of(vessel.id)
      .filter(isUpsert)
      .map((event) => Date.parse(snapshotOf(event).updatedAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });

  it('republishes every vessel that embeds a changed fuel, type, engine or formula', async () => {
    const shared = await createReferenceSet(service);
    const otherFuel = await createReference(service, '/api/v2/fuels', {
      code: uniqueCode('fuel'),
      name: 'Heavy fuel oil (test)',
      carbonContent: 0.8493,
      conversionFactor: 3.114,
      density: 0.98,
    });
    const first = await createVessel(service, org.admin, shared);
    const second = await createVessel(service, SUPER_ADMIN, shared, {
      orgId: randomUUID(),
    });
    const bystander = await createVessel(service, org.admin, shared, {
      fuelId: otherFuel.id,
      firstFuelFormulaId: null,
    });
    for (const vessel of [first, second, bystander]) {
      await probe.next(vessel.id, isUpsert);
    }
    const bystanderEvents = probe.of(bystander.id).length;

    // Fuel: only the two vessels burning it.
    bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/fuels/${shared.fuelId}`,
        { density: 0.845, conversionFactor: 3.2 },
      ),
      200,
    );
    for (const vessel of [first, second]) {
      const snapshot = snapshotOf(
        await probe.next(
          vessel.id,
          (event) =>
            isUpsert(event) &&
            (event.envelope.data as { fuel: { density: number } }).fuel
              .density === 0.845,
        ),
      );
      expect(snapshot.fuel).toMatchObject({ conversionFactor: 3.2 });
      expect(Date.parse(snapshot.updatedAt)).toBeGreaterThan(
        Date.parse(vessel.updatedAt as string),
      );
    }

    // Vessel type (incl. the regulation-fixed capacity): all three vessels.
    bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/vessel-types/${shared.typeId}`,
        { capacityFixed: 65_000, d: { d1: 0.78, d2: 0.92, d3: 1.1, d4: 1.37 } },
      ),
      200,
    );
    for (const vessel of [first, second, bystander]) {
      const snapshot = snapshotOf(
        await probe.next(
          vessel.id,
          (event) =>
            isUpsert(event) &&
            (event.envelope.data as { type: { capacityFixed: number | null } })
              .type.capacityFixed === 65_000,
        ),
      );
      expect(snapshot.type).toMatchObject({
        d: { d1: 0.78, d2: 0.92, d3: 1.1, d4: 1.37 },
      });
    }

    // Engine and first fuel formula.
    bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/engines/${shared.auxEngineId}`,
        { sfoc: 199.5 },
      ),
      200,
    );
    bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/fuel-formulas/${shared.formulaId}`,
        { mainEngineFormula: '0.42 * speedKnot ^ 1.5' },
      ),
      200,
    );
    const latest = snapshotOf(
      await probe.next(
        first.id,
        (event) =>
          isUpsert(event) &&
          (
            event.envelope.data as {
              firstFuelFormula: { mainEngineFormula: string } | null;
            }
          ).firstFuelFormula?.mainEngineFormula === '0.42 * speedKnot ^ 1.5',
      ),
    );
    expect(latest.auxEngines).toEqual([
      expect.objectContaining({ sfoc: 199.5 }),
      expect.objectContaining({ sfoc: 199.5 }),
    ]);

    // The bystander got exactly the type cascade and the engine cascade, no fuel or formula one.
    await probe.next(
      bystander.id,
      (event) =>
        isUpsert(event) &&
        (event.envelope.data as { auxEngines: { sfoc: number }[] })
          .auxEngines[0]?.sfoc === 199.5,
    );
    expect(probe.of(bystander.id).length - bystanderEvents).toBe(2);

    // A port change republishes nothing (snapshots carry port ids only).
    const before = probe.of(first.id).length;
    bodyOf(
      await service.request(
        SUPER_ADMIN,
        'PATCH',
        `/api/v2/ports/${shared.portIds[0]}`,
        { name: 'Padang Bai (renamed)' },
      ),
      200,
    );
    await service.app.get(OutboxRelay).relayOnce();
    expect(probe.of(first.id).length).toBe(before);

    // Reference rows in use cannot be deleted.
    expect(
      problemOf(
        await service.request(
          SUPER_ADMIN,
          'DELETE',
          `/api/v2/fuels/${shared.fuelId}`,
        ),
        409,
      ).code,
    ).toBe('REFERENCE_IN_USE');
  });

  it('publishes a tombstone when a vessel is deleted', async () => {
    const vessel = await createVessel(service, org.admin, references);
    await probe.next(vessel.id, isUpsert);

    expect(
      (
        await service.request(
          org.admin,
          'DELETE',
          `/api/v2/vessels/${vessel.id}`,
        )
      ).statusCode,
    ).toBe(204);

    const tombstone = await probe.next(
      vessel.id,
      (event) => event.envelope.type === EVENT_TYPES.FLEET_VESSEL_DELETED,
    );
    expect(tombstone.envelope.data).toEqual({
      id: vessel.id,
      mmsi: vessel.mmsi,
      orgId: org.id,
    });
    expect(tombstone.msgId).toBe(tombstone.envelope.id);
    // Compaction keeps only the tombstone for the vessel.
    const stored = await lastStoredFleetMessage(service.app, vessel.id);
    expect(stored?.envelope.type).toBe(EVENT_TYPES.FLEET_VESSEL_DELETED);
  });

  it('republishes a vessel on demand for platform administrators only', async () => {
    const vessel = await createVessel(service, org.admin, references);
    const original = await probe.next(vessel.id, isUpsert);
    const url = `/api/v2/vessels/${vessel.id}/republish`;

    expect(
      problemOf(await service.request(org.admin, 'POST', url), 403).code,
    ).toBe('PLATFORM_ADMIN_REQUIRED');
    problemOf(await service.request(org.viewer, 'POST', url), 403);
    // No fleet route accepts API keys: refused while authenticating, before
    // the platform-admin check (not 403 PLATFORM_ADMIN_REQUIRED).
    expect(
      problemOf(
        await service.app.inject({
          method: 'POST',
          url,
          headers: { 'x-api-key': `sk_${randomUUID()}_secret` },
        }),
        401,
      ).code,
    ).toBe('INVALID_API_KEY');
    expect(
      bodyOf(await service.request(SUPER_ADMIN, 'POST', url), 202),
    ).toEqual({ vesselId: vessel.id, enqueued: 1 });
    problemOf(
      await service.request(
        SUPER_ADMIN,
        'POST',
        `/api/v2/vessels/${randomUUID()}/republish`,
      ),
      404,
    );

    const again = await probe.next(
      vessel.id,
      (event) => isUpsert(event) && event.envelope.id !== original.envelope.id,
    );
    // Same data, new envelope (consumers keep it: equal updatedAt).
    expect(again.envelope.data).toEqual(original.envelope.data);
  });

  it('retries a failing row with backoff while other vessels flow, and parks payloads that can never be published', async () => {
    const relay = service.app.get(OutboxRelay);
    // fleet.outbox has seq and next_attempt_at: the kit relays per key.
    expect(await relay.mode()).toBe('per-key');
    // A row for a stream nobody created in this test (GEO): NATS has no responder.
    // Envelope ids are UUID v7 (spec §7.1), like the ids enqueueEvent assigns.
    const unroutable = newId();
    const zoneId = newId();
    const insertZoneTombstone = (id: string) =>
      pool.query(
        "INSERT INTO outbox (id, type, entity_key, data) VALUES ($1, 'geo.zone.deleted.v1', $2, $3::jsonb)",
        [id, zoneId, JSON.stringify({ id: zoneId, orgId: null })],
      );
    await insertZoneTombstone(unroutable);
    // A later row of the same key: it must wait behind the failing one.
    const behind = newId();
    await insertZoneTombstone(behind);
    // A row whose payload is not a VesselSnapshotV1 any more.
    const poison = newId();
    const vesselId = newId();
    await pool.query(
      "INSERT INTO outbox (id, type, entity_key, data) VALUES ($1, 'fleet.vessel.upserted.v1', $2, $3::jsonb)",
      [poison, vesselId, JSON.stringify({ id: vesselId })],
    );

    const parked = await waitFor(
      async () => {
        const row = await outboxRow(poison);
        return row?.failed_at === null ? false : row;
      },
      { message: 'poison row not parked' },
    );
    expect(parked.last_error).toMatch(/Invalid fleet\.vessel\.upserted\.v1/);
    expect(parked.published_at).toBeNull();

    const retried = await waitFor(
      async () => {
        const row = await outboxRow(unroutable);
        return row !== undefined && row.attempts >= 2 ? row : false;
      },
      { timeoutMs: 15_000, message: 'unroutable row not retried' },
    );
    expect(retried.published_at).toBeNull();
    expect(retried.failed_at).toBeNull();
    expect(retried.last_error).not.toBeNull();
    expect(retried.next_attempt_at.getTime()).toBeGreaterThan(
      Date.now() - 1000,
    );
    // Only its key waits: the later row of the zone was never attempted…
    expect(await outboxRow(behind)).toMatchObject({
      attempts: 0,
      published_at: null,
      failed_at: null,
    });
    // …while the snapshots of other vessels keep flowing (0.1 relays had
    // per-row retries too; the kit's 0.2 relay stopped at the first failure).
    const flowing = await createVessel(service, org.admin, references);
    await probe.next(flowing.id, isUpsert);
    expect((await outboxRow(unroutable))?.published_at).toBeNull();

    // The relay loop refreshes its gauges at most every second (parked rows
    // every 10 s); an explicit pass refreshes them all.
    await relay.relayOnce();
    const metrics = await service.app.inject({
      method: 'GET',
      url: '/metrics',
    });
    expect(metrics.body).toMatch(
      /aisits_outbox_relayed_total\{[^}]*outcome="failed"[^}]*\} [1-9]/,
    );
    expect(metrics.body).toMatch(
      /aisits_outbox_relayed_total\{[^}]*outcome="rejected"[^}]*\} [1-9]/,
    );
    expect(metrics.body).toMatch(/aisits_outbox_retrying_rows [1-9]/);
    expect(metrics.body).toMatch(/aisits_outbox_failed_rows [1-9]/);
    expect(metrics.body).toMatch(
      /aisits_fleet_snapshots_enqueued_total\{reason="reference_change"\} [1-9]/,
    );

    await pool.query('DELETE FROM outbox WHERE id = ANY($1::uuid[])', [
      [unroutable, behind, poison],
    ]);
    const vessel = await createVessel(service, org.admin, references);
    await probe.next(vessel.id, isUpsert);
    expect((await relay.relayOnce()).rejected).toBe(0);
  });

  it('publishes every vessel a pass claims at once, so an unreachable NATS costs one request timeout per pass', async () => {
    // More vessels than the kit's default concurrency (64 keys at once), with
    // which a pass waited one JetStream request timeout per group of 64.
    const size = service.config.OUTBOX_BATCH_SIZE;
    expect(size).toBeGreaterThan(64);
    const pendingRows = async (): Promise<number> => {
      const { rows } = await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM outbox WHERE published_at IS NULL AND failed_at IS NULL',
      );
      return rows[0]?.count ?? 0;
    };
    // Nothing else is due: the next pass claims exactly the rows below.
    await waitFor(async () => (await pendingRows()) === 0, {
      message: 'the outbox did not drain',
    });

    // A NATS that accepts the connection but never answers: every
    // publication hangs until the request timeout (`endOutage()`), then fails.
    let inFlight = 0;
    let peak = 0;
    let endOutage: () => void = () => undefined;
    const outage = new Promise<void>((resolve) => {
      endOutage = resolve;
    });
    const spy = vi
      .spyOn(service.app.get(EventPublisher), 'publishEvent')
      .mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          await outage;
        } finally {
          inFlight -= 1;
        }
        throw new Error('TimeoutError: timeout');
      });
    const ids: string[] = [];
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let index = 0; index < size; index += 1) {
          const vesselId = newId();
          ids.push(
            await enqueueEvent(
              client,
              EVENT_TYPES.FLEET_VESSEL_DELETED,
              { id: vesselId, mmsi: uniqueMmsi(), orgId: org.id },
              { entityKey: vesselId },
            ),
          );
        }
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      service.app.get(OutboxRelay).notify();

      // One pass has every vessel in flight at once…
      await waitFor(() => inFlight >= size, {
        message: `fewer than ${size} publications in flight at once`,
      });
      expect(peak).toBe(size);
      // …so one timeout ends it: every vessel failed once and waits for its retry.
      endOutage();
      await waitFor(
        async () => {
          const { rows } = await pool.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM outbox WHERE id = ANY($1::uuid[]) AND attempts >= 1',
            [ids],
          );
          return rows[0]?.count === size;
        },
        { message: 'the pass did not record a failure for every vessel' },
      );
    } finally {
      endOutage();
      await pool.query('DELETE FROM outbox WHERE id = ANY($1::uuid[])', [ids]);
      spy.mockRestore();
    }
  });

  it('republishes the whole fleet on boot with FLEET_REPUBLISH_ON_BOOT=true', async () => {
    const vessel = await createVessel(service, org.admin, references);
    const original = await probe.next(vessel.id, isUpsert);
    const { rows } = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM vessels',
    );
    const fleetSize = rows[0]?.count ?? 0;

    // A second replica boots with the flag (both relays share the outbox).
    const replica = await startTestService({ FLEET_REPUBLISH_ON_BOOT: 'true' });
    try {
      const again = await probe.next(
        vessel.id,
        (event) =>
          isUpsert(event) && event.envelope.id !== original.envelope.id,
        20_000,
      );
      expect(again.envelope.data).toEqual(original.envelope.data);
    } finally {
      await replica.app.close();
    }
    const enqueued = await pool.query<{ count: number }>(
      "SELECT count(DISTINCT entity_key)::int AS count FROM outbox WHERE type = 'fleet.vessel.upserted.v1' AND created_at > $1",
      [new Date(Date.parse(original.envelope.time))],
    );
    expect(enqueued.rows[0]?.count).toBeGreaterThanOrEqual(fleetSize);
  });
});

/** A FLEET message as core NATS delivered it (every publication, whichever relay sent it). */
interface DeliveredFleetMessage {
  readonly subject: string;
  readonly id: string;
  readonly data: VesselSnapshotV1;
}

describe('several relay replicas and concurrent writers', () => {
  let primary: TestService;
  let replica: TestService;
  let pool: Pool;
  let references: ReferenceSet;
  let subscription: ReturnType<NatsClient['connection']['subscribe']>;
  const org = newOrganization();
  /**
   * Core NATS sees every publication in the order the server routed it: the
   * stream keeps only the last message per vessel, so a JetStream consumer
   * may skip superseded ones, a plain subscription never does.
   */
  const delivered: DeliveredFleetMessage[] = [];
  const deliveredOf = (vesselId: string): DeliveredFleetMessage[] =>
    delivered.filter(
      (message) => message.subject === subjects.fleetVessel(vesselId),
    );

  beforeAll(async () => {
    // One row per pass: both relays loop pass after pass over a backlog.
    primary = await startTestService({ OUTBOX_BATCH_SIZE: '1' });
    replica = await startTestService({ OUTBOX_BATCH_SIZE: '1' });
    pool = primary.app.get<unknown, Pool>(PG_POOL);
    references = await createReferenceSet(primary);
    const connection = primary.app.get(NatsClient).connection;
    subscription = connection.subscribe(SUBJECT_FILTERS.FLEET_VESSEL);
    void (async () => {
      for await (const message of subscription) {
        const parsed = parseEnvelope(message.data);
        if (!parsed.success) continue;
        if (parsed.envelope.type !== EVENT_TYPES.FLEET_VESSEL_UPSERTED)
          continue;
        delivered.push({
          subject: message.subject,
          id: parsed.envelope.id,
          data: parsed.envelope.data,
        });
      }
    })();
    await connection.flush();
  });

  afterAll(async () => {
    subscription.unsubscribe();
    await replica.app.close();
    await primary.app.close();
  });

  it('lets two relays share a backlog and publishes every vessel in commit order without gaps', async () => {
    const vessels = [];
    for (let index = 0; index < 4; index += 1) {
      vessels.push(await createVessel(primary, org.admin, references));
    }
    const initial = new Map<string, VesselSnapshotV1>();
    for (const vessel of vessels) {
      const first = await waitFor(() => deliveredOf(vessel.id)[0] ?? false, {
        message: `no snapshot of ${vessel.id}`,
      });
      initial.set(vessel.id, first.data);
    }
    const spies = [primary, replica].map((service) =>
      vi.spyOn(service.app.get(EventPublisher), 'publishEvent'),
    );

    // The backlog: six versions per vessel, interleaved, committed at once.
    const enqueued = new Map<string, string[]>(
      vessels.map((vessel) => [vessel.id, []]),
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let version = 1; version <= 6; version += 1) {
        for (const vessel of vessels) {
          const base = initial.get(vessel.id);
          if (base === undefined) throw new Error('missing snapshot');
          const id = await enqueueEvent(
            client,
            EVENT_TYPES.FLEET_VESSEL_UPSERTED,
            {
              ...base,
              name: `Backlog v${version}`,
              updatedAt: new Date(
                Date.parse(base.updatedAt) + version * 1000,
              ).toISOString(),
            },
            { entityKey: vessel.id },
          );
          enqueued.get(vessel.id)?.push(id);
        }
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    for (const service of [primary, replica]) {
      service.app.get(OutboxRelay).notify();
    }

    const backlog = new Set([...enqueued.values()].flat());
    await waitFor(
      () =>
        delivered.filter((message) => backlog.has(message.id)).length >=
        backlog.size,
      { timeoutMs: 20_000, message: 'the backlog was not published' },
    );
    for (const vessel of vessels) {
      // Exactly the enqueued rows, in seq order: none missing, none twice.
      expect(
        deliveredOf(vessel.id)
          .map((message) => message.id)
          .filter((id) => backlog.has(id)),
      ).toEqual(enqueued.get(vessel.id));
      expect(deliveredOf(vessel.id).at(-1)?.data.name).toBe('Backlog v6');
    }
    // Both replicas took part (rows of one vessel moved between them).
    for (const spy of spies) {
      const relayed = spy.mock.calls.filter((call) =>
        backlog.has(String((call[2] as { id?: string } | undefined)?.id)),
      );
      expect(relayed.length).toBeGreaterThan(0);
      spy.mockRestore();
    }
    const pending = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM outbox WHERE id = ANY($1::uuid[]) AND published_at IS NULL',
      [[...backlog]],
    );
    expect(pending.rows[0]?.count).toBe(0);
  });

  it('keeps every vessel ordered and current while its writes race a reference cascade', async () => {
    const shared = await createReferenceSet(primary);
    const vessels = [];
    for (let index = 0; index < 3; index += 1) {
      vessels.push(await createVessel(primary, org.admin, shared));
    }
    const writerOf = (index: number): TestService =>
      index % 2 === 0 ? primary : replica;
    const rounds = 3;
    for (let round = 1; round <= rounds; round += 1) {
      // Vessel writes (vessel row, then the fuel share-locked) race a fuel
      // change (fuel row, then every vessel burning it): deadlocks are retried.
      const responses = await Promise.all([
        ...vessels.map((vessel, index) =>
          writerOf(index).request(
            org.admin,
            'PATCH',
            `/api/v2/vessels/${vessel.id}`,
            { name: `Race ${round}.${index}` },
          ),
        ),
        writerOf(round).request(
          SUPER_ADMIN,
          'PATCH',
          `/api/v2/fuels/${shared.fuelId}`,
          { density: 0.8 + round / 100 },
        ),
      ]);
      for (const response of responses) {
        expect(response.statusCode, response.body).toBe(200);
      }
    }

    for (const [index, vessel] of vessels.entries()) {
      const detail = bodyOf<{ updatedAt: string }>(
        await primary.request(org.admin, 'GET', `/api/v2/vessels/${vessel.id}`),
        200,
      );
      expect(detail).toMatchObject({
        name: `Race ${rounds}.${index}`,
        fuel: { density: 0.8 + rounds / 100 },
      });
      // The last snapshot delivered is the current state, fuel included …
      const last = await waitFor(
        () => {
          const tail = deliveredOf(vessel.id).at(-1);
          return tail?.data.updatedAt === detail.updatedAt ? tail : false;
        },
        { timeoutMs: 20_000, message: `stale last snapshot of ${vessel.id}` },
      );
      expect(last.data).toMatchObject({
        name: `Race ${rounds}.${index}`,
        fuel: { density: 0.8 + rounds / 100 },
      });
      // … and no snapshot was delivered after a newer one.
      const times = deliveredOf(vessel.id).map((message) =>
        Date.parse(message.data.updatedAt),
      );
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it('cascades over more vessels than one statement may carry bind parameters', async () => {
    const aggregates = primary.app.get(VesselAggregatesRepository);
    const client = await pool.connect();
    try {
      // Rolled back: the 70 000 vessels are never visible to other tests.
      await client.query('BEGIN');
      const db: FleetDb = drizzle({ client, schema });
      const fuelId = newId();
      await db.execute(
        sql`INSERT INTO fuels (id, code, name, carbon_content, conversion_factor, density)
            VALUES (${fuelId}, ${uniqueCode('fuel')}, 'Cascade fuel (test)', 0.8744, 3.206, 0.86)`,
      );
      await db.execute(
        sql`INSERT INTO vessels (id, mmsi, name, annual_voyage_percentage, type_id, fuel_id)
            SELECT gen_random_uuid(), 990000000 + i, 'Cascade ' || i, 50, ${references.typeId}, ${fuelId}
              FROM generate_series(1, 70000) AS i`,
      );
      // Regression: one bind parameter per vessel failed beyond 65 535.
      const touched = await aggregates.touchVesselsUsing(db, { fuelId });
      expect(touched).toHaveLength(70_000);
      expect(new Set(touched).size).toBe(70_000);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
