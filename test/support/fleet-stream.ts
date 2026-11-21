import {
  type AnyEventEnvelope,
  EVENT_TYPES,
  parseEnvelope,
  SUBJECT_FILTERS,
  subjects,
} from '@darmawanweb/ais-its-contracts/events';
import {
  NatsClient,
  type OrderedSubscription,
  OrderedConsumers,
} from '@darmawanweb/ais-its-nest/nats';
import { waitFor } from '@darmawanweb/ais-its-nest/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** `Nats-Msg-Id` of a message (`MsgHdrs.get` answers '' for a missing header). */
function msgIdOf(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/** A FLEET message received by the probe. */
export interface ReceivedFleetEvent {
  readonly envelope: AnyEventEnvelope;
  readonly subject: string;
  /** The `Nats-Msg-Id` header (= outbox row id = envelope id). */
  readonly msgId: string | undefined;
}

/**
 * Consumes `fleet.vessel.v1.>` from NATS with an ordered consumer (as the
 * downstream services do) and records every envelope, so tests can wait
 * for the snapshots the outbox relay publishes.
 */
export class FleetStreamProbe {
  readonly events: ReceivedFleetEvent[] = [];

  private constructor(private subscription: OrderedSubscription | undefined) {}

  /** Starts consuming new FLEET messages. */
  static async start(app: NestFastifyApplication): Promise<FleetStreamProbe> {
    const probe = new FleetStreamProbe(undefined);
    probe.subscription = await app.get(OrderedConsumers).start({
      name: 'fleet-test-probe',
      stream: 'FLEET',
      filterSubjects: [SUBJECT_FILTERS.FLEET_VESSEL],
      eventTypes: [
        EVENT_TYPES.FLEET_VESSEL_UPSERTED,
        EVENT_TYPES.FLEET_VESSEL_DELETED,
      ],
      deliver: 'new',
      handler: (envelope, context) => {
        probe.events.push({
          envelope,
          subject: context.subject,
          msgId: msgIdOf(context.headers?.get('Nats-Msg-Id')),
        });
      },
    });
    return probe;
  }

  /** Events received for one vessel, in delivery order. */
  of(vesselId: string): ReceivedFleetEvent[] {
    return this.events.filter(
      (event) => event.subject === subjects.fleetVessel(vesselId),
    );
  }

  /** Waits for an event of the vessel that satisfies `predicate`. */
  async next(
    vesselId: string,
    predicate: (event: ReceivedFleetEvent) => boolean,
    timeoutMs = 10_000,
  ): Promise<ReceivedFleetEvent> {
    return waitFor(() => this.of(vesselId).find(predicate) ?? false, {
      timeoutMs,
      message: `No matching FLEET event for vessel ${vesselId}`,
    });
  }

  async stop(): Promise<void> {
    await this.subscription?.stop();
  }
}

/** The last message stored in the FLEET stream for a vessel (the stream keeps one per subject). */
export async function lastStoredFleetMessage(
  app: NestFastifyApplication,
  vesselId: string,
): Promise<
  { envelope: AnyEventEnvelope; msgId: string | undefined } | undefined
> {
  try {
    const stored = await app
      .get(NatsClient)
      .manager.streams.getMessage('FLEET', {
        last_by_subj: subjects.fleetVessel(vesselId),
      });
    if (stored === null) return undefined;
    const parsed = parseEnvelope(stored.data);
    if (!parsed.success) throw new Error(parsed.message);
    return {
      envelope: parsed.envelope,
      msgId: msgIdOf(stored.header.get('Nats-Msg-Id')),
    };
  } catch (error) {
    // "no message found" while nothing was published for the subject yet.
    if (error instanceof Error && /no message found/i.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}
