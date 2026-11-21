import { randomBytes } from 'node:crypto';

import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PHOTO_MAX_BYTES } from '../src/domain/photo.js';
import { PhotoStorage } from '../src/modules/storage/photo-storage.js';
import {
  bodyOf,
  createReferenceSet,
  createVessel,
  problemOf,
  type ReferenceSet,
} from './support/fleet-fixtures.js';
import {
  type Actor,
  type InjectResponse,
  newOrganization,
  startTestService,
  type TestService,
} from './support/test-service.js';

/** A PNG signature followed by filler (the service checks magic bytes only). */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(256),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  randomBytes(256),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
  randomBytes(64),
]);

/** A `multipart/form-data` body with one file field. */
function multipart(
  bytes: Buffer,
  options: { field?: string; filename?: string; contentType?: string } = {},
): { payload: Buffer; contentType: string } {
  const boundary = `----fleet-test-${randomBytes(8).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${options.field ?? 'file'}"; filename="${options.filename ?? 'photo.bin'}"\r\n` +
      `Content-Type: ${options.contentType ?? 'application/octet-stream'}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** A browser host for presigned URLs that differs from S3_ENDPOINT but reaches the same container. */
function publicEndpointOf(endpoint: string): string {
  const url = new URL(endpoint);
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return url.origin;
}

describe('vessel photos in S3 (RustFS)', () => {
  let service: TestService;
  let references: ReferenceSet;
  let s3: S3Client;
  const infra = inject('infra');
  const publicEndpoint = publicEndpointOf(infra.s3.endpoint);
  const bucket = `photos-${randomBytes(4).toString('hex')}`;
  const org = newOrganization();
  const outsider = newOrganization();

  const upload = async (
    actor: Actor,
    vesselId: string,
    body: { payload: Buffer; contentType: string },
  ): Promise<InjectResponse> =>
    service.app.inject({
      method: 'POST',
      url: `/api/v2/vessels/${vesselId}/photo`,
      headers: {
        ...(await service.authorization({
          roles: actor.roles,
          orgId: actor.orgId,
        })),
        'content-type': body.contentType,
      },
      payload: body.payload,
    });

  const objectsOf = async (vesselId: string): Promise<string[]> => {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `vessels/${vesselId}/`,
      }),
    );
    return (listed.Contents ?? []).map((object) => object.Key ?? '');
  };

  beforeAll(async () => {
    service = await startTestService({
      S3_BUCKET_PHOTOS: bucket,
      S3_PUBLIC_ENDPOINT: publicEndpoint,
    });
    // The bucket is ensured in the background at bootstrap; wait for it.
    await service.app.get(PhotoStorage).ensureBucket();
    s3 = new S3Client({
      endpoint: infra.s3.endpoint,
      region: infra.s3.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: infra.s3.accessKey,
        secretAccessKey: infra.s3.secretKey,
      },
    });
    references = await createReferenceSet(service);
  });

  afterAll(async () => {
    s3.destroy();
    await service.app.close();
  });

  it('uploads a photo, serves it through a presigned URL and replaces it', async () => {
    const vessel = await createVessel(service, org.fleetManager, references);

    const stored = bodyOf<{ photoUrl: string; updatedAt: string }>(
      await upload(
        org.fleetManager,
        vessel.id,
        multipart(PNG, { filename: 'ship.png', contentType: 'image/png' }),
      ),
      201,
    );
    const url = new URL(stored.photoUrl);
    expect(url.origin).toBe(publicEndpoint);
    expect(url.pathname).toMatch(
      new RegExp(`^/${bucket}/vessels/${vessel.id}/[0-9a-f-]{36}\\.png$`),
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

    const downloaded = await fetch(stored.photoUrl);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await downloaded.arrayBuffer()).equals(PNG)).toBe(true);
    expect(await objectsOf(vessel.id)).toHaveLength(1);

    // The photo is part of the shared identity: other tenants see it too.
    const summary = bodyOf<{ view: string; photoUrl: string | null }>(
      await service.request(
        outsider.viewer,
        'GET',
        `/api/v2/vessels/${vessel.id}`,
      ),
      200,
    );
    expect(summary.view).toBe('summary');
    expect(summary.photoUrl).toMatch(new RegExp(`/vessels/${vessel.id}/`));

    // A new upload gets a new key; the previous object is removed.
    const replaced = bodyOf<{ photoUrl: string }>(
      await upload(
        org.admin,
        vessel.id,
        // The declared type is ignored: the bytes are a JPEG.
        multipart(JPEG, { filename: 'ship.png', contentType: 'image/png' }),
      ),
      201,
    );
    expect(new URL(replaced.photoUrl).pathname).toMatch(/\.jpg$/);
    expect((await fetch(stored.photoUrl)).status).toBe(404);
    const current = await fetch(replaced.photoUrl);
    expect(current.headers.get('content-type')).toBe('image/jpeg');
    expect(await objectsOf(vessel.id)).toHaveLength(1);

    const webp = bodyOf<{ photoUrl: string }>(
      await upload(org.admin, vessel.id, multipart(WEBP)),
      201,
    );
    expect(new URL(webp.photoUrl).pathname).toMatch(/\.webp$/);
  });

  it('refuses files that are not JPEG, PNG or WebP, too large or missing', async () => {
    const vessel = await createVessel(service, org.admin, references);

    const text = problemOf(
      await upload(
        org.admin,
        vessel.id,
        multipart(Buffer.from('GIF89a not really'), {
          contentType: 'image/png',
        }),
      ),
      415,
    );
    expect(text.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const tooLarge = problemOf(
      await upload(
        org.admin,
        vessel.id,
        multipart(Buffer.concat([PNG, Buffer.alloc(PHOTO_MAX_BYTES)])),
      ),
      413,
    );
    expect(tooLarge.code).toBe('PAYLOAD_TOO_LARGE');

    const json = problemOf(
      await service.request(
        org.admin,
        'POST',
        `/api/v2/vessels/${vessel.id}/photo`,
        { file: 'not a file' },
      ),
      415,
    );
    expect(json.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    // Nothing was stored for the refused uploads.
    expect(await objectsOf(vessel.id)).toEqual([]);
    const unchanged = bodyOf<{ photoUrl: string | null }>(
      await service.request(org.admin, 'GET', `/api/v2/vessels/${vessel.id}`),
      200,
    );
    expect(unchanged.photoUrl).toBeNull();
  });

  it('lets only the owning organization change the photo', async () => {
    const vessel = await createVessel(service, org.admin, references);

    expect(
      problemOf(await upload(outsider.admin, vessel.id, multipart(PNG)), 403)
        .code,
    ).toBe('FORBIDDEN');
    problemOf(await upload(org.viewer, vessel.id, multipart(PNG)), 403);
    expect(await objectsOf(vessel.id)).toEqual([]);

    bodyOf(await upload(org.admin, vessel.id, multipart(PNG)), 201);
    problemOf(
      await service.request(
        outsider.admin,
        'DELETE',
        `/api/v2/vessels/${vessel.id}/photo`,
      ),
      403,
    );
    expect(await objectsOf(vessel.id)).toHaveLength(1);
  });

  it('deletes the stored object with the photo and with the vessel', async () => {
    const vessel = await createVessel(service, org.admin, references);
    const { photoUrl } = bodyOf<{ photoUrl: string }>(
      await upload(org.admin, vessel.id, multipart(PNG)),
      201,
    );

    expect(
      (
        await service.request(
          org.admin,
          'DELETE',
          `/api/v2/vessels/${vessel.id}/photo`,
        )
      ).statusCode,
    ).toBe(204);
    expect(await objectsOf(vessel.id)).toEqual([]);
    expect((await fetch(photoUrl)).status).toBe(404);
    const after = bodyOf<{ photoUrl: string | null }>(
      await service.request(org.admin, 'GET', `/api/v2/vessels/${vessel.id}`),
      200,
    );
    expect(after.photoUrl).toBeNull();
    expect(
      problemOf(
        await service.request(
          org.admin,
          'DELETE',
          `/api/v2/vessels/${vessel.id}/photo`,
        ),
        404,
      ).code,
    ).toBe('PHOTO_NOT_FOUND');

    // Deleting a vessel removes its photo object as well.
    bodyOf(await upload(org.admin, vessel.id, multipart(PNG)), 201);
    expect(await objectsOf(vessel.id)).toHaveLength(1);
    expect(
      (
        await service.request(
          org.admin,
          'DELETE',
          `/api/v2/vessels/${vessel.id}`,
        )
      ).statusCode,
    ).toBe(204);
    expect(await objectsOf(vessel.id)).toEqual([]);

    const metrics = await service.app.inject({
      method: 'GET',
      url: '/metrics',
    });
    expect(metrics.body).toMatch(
      /aisits_fleet_photo_operations_total\{operation="upload",outcome="stored"\} [1-9]/,
    );
    expect(metrics.body).toMatch(
      /aisits_fleet_photo_operations_total\{operation="delete",outcome="deleted"\} [1-9]/,
    );
  });
});
