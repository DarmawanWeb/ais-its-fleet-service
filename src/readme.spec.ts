import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Config } from './config.js';
import { outboxModuleOptions } from './modules/snapshots/outbox-options.js';

/**
 * Statements of the README handbook that follow from the code or the
 * committed `openapi.json`: the API prefixes the gateway routes (spec §12),
 * how API keys are answered and how many vessels a relay pass publishes at
 * once.
 */
const read = (path: string | URL): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const readme = read('../README.md');
const readmeLines = readme.split('\n');

interface OpenApiDocument {
  readonly paths: Record<
    string,
    Record<string, { readonly security?: readonly unknown[] }>
  >;
}
const openapi = JSON.parse(read('../openapi.json')) as OpenApiDocument;

/** First segments of the `/api/v2/…` paths the service serves. */
const prefixes = [
  ...new Set(
    Object.keys(openapi.paths).flatMap(
      (path) => /^\/api\/v2\/([^/]+)/.exec(path)?.[1] ?? [],
    ),
  ),
].sort();

/** The platform spec, present when the service is checked out in the central repository. */
const platformSpec = new URL('../../../docs/PLATFORM_SPEC.md', import.meta.url);

/** The row of the error table for `status` that lists `code`. */
const errorRow = (status: number, code: string): string | undefined =>
  readmeLines.find(
    (line) => line.startsWith(`| ${status} `) && line.includes(`\`${code}\``),
  );

describe('README', () => {
  it('shows every API prefix of the service on the gateway edge of the architecture diagram', () => {
    expect(prefixes).toContain('fleet');
    const edge = readmeLines.find((line) =>
      line.includes('gw[Traefik gateway]'),
    );
    const label = /\|([^|]*)\|\s*gw\[/.exec(edge ?? '')?.[1] ?? '';
    const listed = label
      .split(/,|<br\/>/)
      .map((entry) => entry.trim().replace(/^\/api\/v2/, ''))
      .filter((entry) => entry !== '')
      .sort();
    expect(listed).toEqual(prefixes.map((prefix) => `/${prefix}`));
    // Spec §12, Traefik and Helm route /api/v2/fleet here (GET /fleet/methodology).
    expect(readme).not.toMatch(/gateway does not route/);
  });

  it.skipIf(!existsSync(platformSpec))(
    'matches the gateway routes of the platform spec (§12)',
    () => {
      const routes = readFileSync(platformSpec, 'utf8')
        .split('\n')
        .find((line) => line.includes('| fleet:3002 |'));
      for (const prefix of prefixes)
        expect(routes).toContain(`\`/api/v2/${prefix}\``);
    },
  );

  it('documents that API keys get 401 INVALID_API_KEY, since no route accepts them', () => {
    const apiKeyOperations = Object.entries(openapi.paths).flatMap(
      ([path, item]) =>
        Object.entries(item)
          .filter(([, operation]) =>
            JSON.stringify(operation.security ?? []).includes('apiKey'),
          )
          .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(apiKeyOperations).toEqual([]);
    expect(errorRow(401, 'INVALID_API_KEY')).toBeDefined();
    // Not 403 PLATFORM_ADMIN_REQUIRED on the platform-admin route either.
    const platformAdmin = errorRow(403, 'PLATFORM_ADMIN_REQUIRED');
    expect(platformAdmin).toContain('401 INVALID_API_KEY');
    expect(platformAdmin).not.toMatch(/and API keys? on/);
  });

  it('describes the relay as publishing every vessel of a pass at once', () => {
    const config = { OUTBOX_BATCH_SIZE: 250 } as Config;
    expect(outboxModuleOptions(config).publishConcurrency).toBe(250);
    expect(readme).toContain('`publishConcurrency` = `OUTBOX_BATCH_SIZE`');
    expect(readme).not.toMatch(/up to 64 vessels at once/);
  });
});
