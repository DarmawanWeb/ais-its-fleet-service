import {
  provisionServiceSchema,
  startTestInfra,
} from '@darmawanweb/ais-its-nest/testing';
import type { TestProject } from 'vitest/node';

import { SERVICE } from '../../src/service.js';

/**
 * Starts TimescaleDB/PostGIS, NATS and S3 (RustFS) once for all integration
 * test files, provisions the service schema and role like
 * `infra/postgres/bootstrap.sql` and provides the endpoints
 * (`inject('infra')`). The teardown stops every container.
 */
export async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  // `test.env` does not reach the main process that runs this setup.
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
  const infra = await startTestInfra({ postgres: true, nats: true, s3: true });
  try {
    const databaseUrl = await provisionServiceSchema(
      infra.postgres.adminUrl,
      SERVICE.schema,
    );
    project.provide('infra', {
      databaseUrl,
      natsUrl: infra.nats.url,
      s3: {
        endpoint: infra.s3.endpoint,
        region: infra.s3.region,
        accessKey: infra.s3.accessKey,
        secretKey: infra.s3.secretKey,
      },
    });
  } catch (error) {
    await infra.stop();
    throw error;
  }
  return () => infra.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    infra: {
      /** `DATABASE_URL` of the service role. */
      databaseUrl: string;
      natsUrl: string;
      /** The RustFS container (S3 API). */
      s3: {
        endpoint: string;
        region: string;
        accessKey: string;
        secretKey: string;
      };
    };
  }
}
