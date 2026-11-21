import { randomUUID } from 'node:crypto';

import type { Role } from '@darmawanweb/ais-its-contracts/auth';
import { ACCESS_TOKEN_KEY_RESOLVER } from '@darmawanweb/ais-its-nest/auth';
import {
  buildTestApp,
  createTestConfig,
  createTestJwtIssuer,
  type TestJwtIssuer,
  type TestTokenClaims,
} from '@darmawanweb/ais-its-nest/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { inject } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { type Config, configSchema } from '../../src/config.js';
import { PHOTO_MULTIPART_OPTIONS } from '../../src/modules/vessels/photo-upload.js';
import { OPENAPI } from '../../src/openapi.options.js';
import { SERVICE } from '../../src/service.js';

/** HTTP methods used by the tests. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A signed-in principal of a test request. */
export interface Actor {
  readonly roles: readonly Role[];
  readonly orgId: string | null;
  readonly userId?: string | undefined;
}

/** The response of `app.inject()` (light-my-request). */
export type InjectResponse = Awaited<
  ReturnType<NestFastifyApplication['inject']>
>;

/** The real application on the shared containers, with a test token issuer. */
export interface TestService {
  readonly app: NestFastifyApplication;
  readonly config: Config;
  readonly jwt: TestJwtIssuer;
  /** `Authorization` header with a freshly signed access token. */
  authorization(claims?: TestTokenClaims): Promise<{ authorization: string }>;
  /** A JSON request as `actor` (anonymous when `null`). */
  request(
    actor: Actor | null,
    method: HttpMethod,
    url: string,
    body?: object,
  ): Promise<InjectResponse>;
}

/** A platform administrator without an active organization. */
export const SUPER_ADMIN: Actor = { roles: ['super_admin'], orgId: null };

/** Principals of one organization, one per tenant role. */
export interface Organization {
  readonly id: string;
  readonly admin: Actor;
  readonly fleetManager: Actor;
  readonly viewer: Actor;
  readonly authority: Actor;
}

/** A fresh organization (random id) with one actor per role. */
export function newOrganization(): Organization {
  const id = randomUUID();
  return {
    id,
    admin: { roles: ['org_admin'], orgId: id },
    fleetManager: { roles: ['fleet_manager'], orgId: id },
    viewer: { roles: ['viewer'], orgId: id },
    authority: { roles: ['authority'], orgId: id },
  };
}

/**
 * Builds and initializes the AppModule as `bootstrapService()` does (hooks
 * run: migrations apply, streams, the outbox relay and the bucket check
 * start) without listening; use `request()` / `app.inject()` and close it
 * with `app.close()`.
 */
export async function startTestService(
  env: Readonly<Record<string, string>> = {},
): Promise<TestService> {
  const infra = inject('infra');
  const jwt = await createTestJwtIssuer();
  const config = createTestConfig(configSchema, {
    SERVICE_NAME: SERVICE.name,
    DATABASE_URL: infra.databaseUrl,
    DATABASE_SCHEMA: SERVICE.schema,
    DB_MIGRATE_ON_BOOT: 'true',
    NATS_URL: infra.natsUrl,
    S3_ENDPOINT: infra.s3.endpoint,
    S3_REGION: infra.s3.region,
    S3_ACCESS_KEY: infra.s3.accessKey,
    S3_SECRET_KEY: infra.s3.secretKey,
    OUTBOX_POLL_INTERVAL_MS: '50',
    OUTBOX_MAX_BACKOFF_MS: '200',
    ...env,
  });
  const app = await buildTestApp(AppModule, {
    config,
    openapi: OPENAPI,
    multipart: PHOTO_MULTIPART_OPTIONS,
    overrides: [
      { provide: ACCESS_TOKEN_KEY_RESOLVER, useValue: jwt.keyResolver },
    ],
  });
  const authorization = async (
    claims?: TestTokenClaims,
  ): Promise<{ authorization: string }> => ({
    authorization: `Bearer ${await jwt.sign(claims)}`,
  });
  return {
    app,
    config,
    jwt,
    authorization,
    async request(actor, method, url, body) {
      const headers =
        actor === null
          ? {}
          : await authorization({
              roles: actor.roles,
              orgId: actor.orgId,
              userId: actor.userId,
            });
      return app.inject({
        method,
        url,
        headers,
        ...(body === undefined ? {} : { payload: body }),
      });
    },
  };
}
