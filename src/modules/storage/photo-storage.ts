import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InjectConfig } from '@darmawanweb/ais-its-nest';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import type { Config } from '../../config.js';
import {
  PHOTO_URL_TTL_SECONDS,
  type PhotoMediaType,
} from '../../domain/photo.js';

/** Attempts of the bucket check at startup before the service gives up waiting. */
const ENSURE_BUCKET_ATTEMPTS = 3;
const ENSURE_BUCKET_RETRY_MS = 2000;

function isMissingBucket(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === 'NotFound' ||
      error.name === 'NoSuchBucket')
  );
}

function isOwnedBucket(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'BucketAlreadyOwnedByYou' ||
      error.name === 'BucketAlreadyExists')
  );
}

/**
 * Vessel photos in S3-compatible object storage (`S3_BUCKET_PHOTOS`, spec
 * §13.3). Two clients: one for the S3 API the service talks to
 * (`S3_ENDPOINT`), one that only signs GET URLs for the host browsers use
 * (`S3_PUBLIC_ENDPOINT`) — presigning makes no network call. No connection
 * is opened at construction; the bucket is ensured after bootstrap.
 */
@Injectable()
export class PhotoStorage
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('PhotoStorage');
  private readonly client: S3Client;
  private readonly signer: S3Client;
  private readonly bucket: string;
  private bucketReady: Promise<void> | undefined;

  constructor(@InjectConfig() config: Config) {
    const options = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
    };
    this.client = new S3Client({ ...options, endpoint: config.S3_ENDPOINT });
    this.signer = new S3Client({
      ...options,
      endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
    });
    this.bucket = config.S3_BUCKET_PHOTOS;
  }

  /**
   * Ensures the bucket in the background: object storage being down must
   * not keep vessels and reference data from being served (it is not a
   * readiness dependency); uploads retry the check.
   */
  onApplicationBootstrap(): void {
    void this.ensureBucket().catch((error: unknown) => {
      this.logger.error(
        `Bucket ${this.bucket} is not available yet (uploads will retry): ${String(error)}`,
      );
    });
  }

  beforeApplicationShutdown(): void {
    this.client.destroy();
    this.signer.destroy();
  }

  /** Creates the bucket when missing (idempotent, shared by concurrent callers). */
  ensureBucket(): Promise<void> {
    this.bucketReady ??= this.createBucketIfMissing().catch(
      (error: unknown) => {
        this.bucketReady = undefined;
        throw error;
      },
    );
    return this.bucketReady;
  }

  /** Stores a photo under `key`. */
  async put(
    key: string,
    body: Uint8Array,
    mediaType: PhotoMediaType,
  ): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mediaType,
        CacheControl: 'private, max-age=3600',
      }),
    );
  }

  /** Deletes an object (S3 deletes are idempotent: a missing key succeeds). */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Deletes an object after the database change committed: a failure is
   * logged (the object is orphaned) instead of failing the request.
   *
   * @returns `true` when the object was deleted
   */
  async deleteQuietly(key: string): Promise<boolean> {
    try {
      await this.delete(key);
      return true;
    } catch (error) {
      this.logger.error(
        `Deleting photo object ${key} failed, the object is orphaned: ${String(error)}`,
      );
      return false;
    }
  }

  /** A presigned GET URL of `key` for browsers, valid {@link PHOTO_URL_TTL_SECONDS}. */
  presignedUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: PHOTO_URL_TTL_SECONDS },
    );
  }

  private async createBucketIfMissing(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        return;
      } catch (error) {
        if (isMissingBucket(error)) {
          await this.createBucket();
          this.logger.log(`Created bucket ${this.bucket}`);
          return;
        }
        if (attempt >= ENSURE_BUCKET_ATTEMPTS) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, ENSURE_BUCKET_RETRY_MS * attempt),
        );
      }
    }
  }

  private async createBucket(): Promise<void> {
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      // Another replica created it first.
      if (!isOwnedBucket(error)) throw error;
    }
  }
}
