import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PG_POOL } from '@darmawanweb/ais-its-nest/db';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR, SERVICE } from '../src/service.js';
import { startTestService, type TestService } from './support/test-service.js';

const METHODOLOGY_URL = `/api/v2/${SERVICE.name}/methodology`;

describe(`${SERVICE.packageName} platform behaviour`, () => {
  let service: TestService;

  beforeAll(async () => {
    service = await startTestService();
  });

  afterAll(async () => {
    await service.app.close();
  });

  it('is live and ready with the database and NATS up', async () => {
    const live = await service.app.inject({
      method: 'GET',
      url: '/health/live',
    });
    expect(live.statusCode).toBe(200);

    const ready = await service.app.inject({
      method: 'GET',
      url: '/health/ready',
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: 'ok',
      details: { database: { status: 'up' }, nats: { status: 'up' } },
    });
  });

  it('applied the migrations to its own schema', async () => {
    const pool = service.app.get<unknown, Pool>(PG_POOL);
    const { rows } = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((row) => row.name)).toEqual([
      'init',
      'outbox_kit_indexes',
      'reference_ids',
    ]);
  });

  it('finds its migrations when started from another working directory', async () => {
    expect(MIGRATIONS_DIR).toBe(
      fileURLToPath(new URL('../migrations', import.meta.url)),
    );
    const cwd = process.cwd();
    // e.g. a process manager starting dist/main.js from elsewhere: no
    // ./migrations there, so the boot fails unless MIGRATIONS_DIR is used.
    const elsewhere = mkdtempSync(join(tmpdir(), 'fleet-cwd-'));
    process.chdir(elsewhere);
    let other: TestService | undefined;
    try {
      other = await startTestService();
      const ready = await other.app.inject({
        method: 'GET',
        url: '/health/ready',
      });
      expect(ready.statusCode).toBe(200);
    } finally {
      process.chdir(cwd);
      rmSync(elsewhere, { recursive: true, force: true });
      await other?.app.close();
    }
  });

  it('denies anonymous requests with 401 problem details', async () => {
    const response = await service.app.inject({
      method: 'GET',
      url: METHODOLOGY_URL,
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.headers['www-authenticate']).toBeDefined();
  });

  it('serves the methodology to a signed-in user', async () => {
    const response = await service.app.inject({
      method: 'GET',
      url: METHODOLOGY_URL,
      headers: await service.authorization({ roles: ['viewer'] }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: SERVICE.name });
  });

  it('documents its routes in /openapi.json', async () => {
    const response = await service.app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const document = response.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(document.paths)).toContain(METHODOLOGY_URL);
  });

  it('documents path parameters, the page maximum and the platform-admin route', async () => {
    interface Operation {
      readonly parameters?: readonly {
        readonly name: string;
        readonly in: string;
        readonly schema?: Record<string, unknown>;
      }[];
      readonly description?: string;
      readonly 'x-required-roles'?: readonly string[];
    }
    const document = (
      await service.app.inject({ method: 'GET', url: '/openapi.json' })
    ).json<{ paths: Record<string, Record<string, Operation>> }>();
    const operation = (path: string, method: string): Operation => {
      const found = document.paths[path]?.[method];
      if (found === undefined) throw new Error(`${method} ${path} missing`);
      return found;
    };
    const parameter = (op: Operation, name: string) =>
      op.parameters?.find((entry) => entry.name === name);

    expect(
      parameter(operation('/api/v2/vessels/{id}', 'get'), 'id')?.schema,
    ).toMatchObject({ type: 'string', format: 'uuid' });
    expect(
      parameter(operation('/api/v2/fuels/{id}', 'patch'), 'id')?.schema,
    ).toMatchObject({ type: 'string', format: 'uuid' });
    expect(
      parameter(operation('/api/v2/vessels/by-mmsi/{mmsi}', 'get'), 'mmsi')
        ?.schema,
    ).toMatchObject({ type: 'string', pattern: '^[0-9]{9}$' });
    expect(
      parameter(operation('/api/v2/vessels', 'get'), 'page')?.schema,
    ).toMatchObject({ maximum: 1_000_000 });
    const republish = operation('/api/v2/vessels/{id}/republish', 'post');
    expect(republish['x-required-roles']).toEqual(['super_admin']);
    expect(republish.description).toContain('PLATFORM_ADMIN_REQUIRED');
    // No fleet route accepts API keys: they are refused before the admin check.
    expect(republish.description).toContain('401 INVALID_API_KEY');
  });

  it('exposes Prometheus metrics', async () => {
    const response = await service.app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('aisits_http_requests_total');
  });
});
