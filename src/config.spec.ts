import { ConfigValidationError, loadConfig } from '@darmawanweb/ais-its-nest';
import { describe, expect, it } from 'vitest';

import { configSchema } from './config.js';
import { SERVICE } from './service.js';

/** Loads the configuration from `env` only (no .env file, no process.env). */
function load(env: Record<string, string> = {}) {
  return loadConfig(configSchema, {
    env: { LOG_LEVEL: 'silent', ...env },
    envFile: false,
    output: null,
  });
}

describe('configSchema', () => {
  it('applies the service defaults (spec §3, §4, §6)', () => {
    const config = load();

    expect(config).toMatchObject({
      NODE_ENV: 'development',
      SERVICE_NAME: SERVICE.name,
      SERVICE_VERSION: SERVICE.version,
      PORT: SERVICE.port,
      DATABASE_SCHEMA: SERVICE.schema,
      DATABASE_URL: `postgres://${SERVICE.schema}_svc:${SERVICE.schema}_svc@localhost:5432/aisits`,
      NATS_URL: ['nats://localhost:4222'],
    });
  });

  it('reads overrides from the environment', () => {
    expect(
      load({ PORT: '4000', NATS_URL: 'nats://a:4222,nats://b:4222' }),
    ).toMatchObject({
      PORT: 4000,
      NATS_URL: ['nats://a:4222', 'nats://b:4222'],
    });
  });

  it('refuses invalid values', () => {
    expect(() => load({ PORT: 'eighty' })).toThrow(ConfigValidationError);
  });

  it('defaults the object storage to the compose RustFS (spec §13.3)', () => {
    expect(load()).toMatchObject({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET_PHOTOS: 'vessel-photos',
      S3_FORCE_PATH_STYLE: true,
      FLEET_REPUBLISH_ON_BOOT: false,
      OUTBOX_BATCH_SIZE: 100,
    });
    expect(load().S3_PUBLIC_ENDPOINT).toBeUndefined();
  });

  it('refuses the development S3 credentials in production', () => {
    expect(() =>
      load({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/aisits',
        INTERNAL_TOKEN: 'a-long-production-secret',
      }),
    ).toThrow(/S3_ACCESS_KEY[\s\S]*S3_SECRET_KEY/);
    expect(
      load({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/aisits',
        INTERNAL_TOKEN: 'a-long-production-secret',
        S3_ACCESS_KEY: 'prod-key',
        S3_SECRET_KEY: 'prod-secret',
      }).S3_ACCESS_KEY,
    ).toBe('prod-key');
  });

  it('refuses the development secrets in production', () => {
    expect(() =>
      load({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db:5432/aisits',
      }),
    ).toThrow(ConfigValidationError);
  });
});
