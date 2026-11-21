import type {
  FastifyMultipartOptions,
  MultipartFile,
} from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';

import { PHOTO_MAX_BYTES } from '../../domain/photo.js';
import {
  invalidField,
  PhotoTooLargeError,
  UnsupportedPhotoError,
} from '../../errors.js';

/** `@fastify/multipart` registration of the service (one photo per request). */
export const PHOTO_MULTIPART_OPTIONS: FastifyMultipartOptions = {
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 5, parts: 6 },
};

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** Maps `@fastify/multipart` limit errors to problem details. */
function uploadError(error: unknown): unknown {
  switch (errorCode(error)) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return new PhotoTooLargeError(PHOTO_MAX_BYTES);
    case 'FST_FILES_LIMIT':
    case 'FST_PARTS_LIMIT':
      return invalidField('file', 'Send exactly one file', 'maxFiles');
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
      return new UnsupportedPhotoError(
        'Expected a multipart/form-data request with one file field',
      );
    case undefined:
    default:
      return error;
  }
}

/**
 * Reads the single file of a `multipart/form-data` upload into memory,
 * refusing more than {@link PHOTO_MAX_BYTES} while streaming (`413`).
 *
 * @throws UnsupportedPhotoError (415) for another content type, `400` without a file
 */
export async function readPhotoUpload(
  request: FastifyRequest,
): Promise<Buffer> {
  if (!request.isMultipart()) {
    throw new UnsupportedPhotoError(
      'Expected a multipart/form-data request with one file field',
    );
  }
  let part: MultipartFile | undefined;
  try {
    part = await request.file({
      limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
    });
  } catch (error) {
    throw uploadError(error);
  }
  if (part === undefined)
    throw invalidField('file', 'A file field is required', 'isDefined');
  try {
    return await part.toBuffer();
  } catch (error) {
    throw uploadError(error);
  }
}
