import {
  type AppConfig,
  defineConfig,
  envBoolean,
  envInteger,
  envUrl,
  ServiceNameSchema,
  SqlIdentifierSchema,
} from '@darmawanweb/ais-its-nest';
import * as z from 'zod';

import { SERVICE } from './service.js';

/** Development credentials of the compose RustFS (`infra/compose`); refused in production. */
export const DEV_S3_CREDENTIALS = Object.freeze({
  accessKey: 'aisits-dev',
  secretKey: 'aisits-dev-secret',
});

/** S3 bucket names: 3–63 lowercase letters, digits, dots and dashes. */
const BucketNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
    'Must be a valid S3 bucket name',
  );

/**
 * Environment of the service: the platform base variables (spec §4) with this
 * service's defaults, plus its own variables (spec §13.3). Add a variable here
 * and to `.env.example`; `loadConfig()` refuses to start on invalid values and
 * prints every problem.
 */
export const configSchema = defineConfig({
  SERVICE_NAME: ServiceNameSchema.default(SERVICE.name),
  SERVICE_VERSION: z.string().min(1).default(SERVICE.version),
  PORT: envInteger(0, 65_535).default(SERVICE.port),
  DATABASE_SCHEMA: SqlIdentifierSchema.default(SERVICE.schema),

  /** S3 API used by the service (uploads, deletes, bucket check). */
  S3_ENDPOINT: envUrl(['http', 'https']).default('http://localhost:9000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).default(DEV_S3_CREDENTIALS.accessKey),
  S3_SECRET_KEY: z.string().min(1).default(DEV_S3_CREDENTIALS.secretKey),
  S3_BUCKET_PHOTOS: BucketNameSchema.default('vessel-photos'),
  /** Path-style addressing (`http://host/bucket/key`), required by RustFS/MinIO. */
  S3_FORCE_PATH_STYLE: envBoolean().default(true),
  /**
   * Host that browsers reach the bucket on: presigned photo URLs are signed
   * for it (the gateway or a CDN in front of the S3 API). Default `S3_ENDPOINT`.
   */
  S3_PUBLIC_ENDPOINT: envUrl(['http', 'https']).optional(),

  /** Re-enqueue the snapshot of every vessel at startup (recovery of the FLEET stream). */
  FLEET_REPUBLISH_ON_BOOT: envBoolean().default(false),

  /** Idle polling interval of the outbox relay, ms. */
  OUTBOX_POLL_INTERVAL_MS: envInteger(10, 60_000).default(500),
  /** Outbox rows locked and published per relay pass. */
  OUTBOX_BATCH_SIZE: envInteger(1, 1000).default(100),
  /** Upper bound of the exponential retry backoff of a failing row, ms. */
  OUTBOX_MAX_BACKOFF_MS: envInteger(100, 3_600_000).default(60_000),
  /** How long published rows stay in `fleet.outbox`, hours. */
  OUTBOX_RETENTION_HOURS: envInteger(1, 24 * 90).default(24),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (env.S3_ACCESS_KEY === DEV_S3_CREDENTIALS.accessKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_ACCESS_KEY'],
      message: 'Must be set in production (not the development default)',
    });
  }
  if (env.S3_SECRET_KEY === DEV_S3_CREDENTIALS.secretKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_SECRET_KEY'],
      message: 'Must be set in production (not the development default)',
    });
  }
});

/** Validated configuration; inject it with `@InjectConfig() config: Config`. */
export type Config = AppConfig<typeof configSchema>;
