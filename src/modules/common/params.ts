import { isValidMmsi } from '@darmawanweb/ais-its-contracts/domain';
import {
  createParamDecorator,
  type ExecutionContext,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { invalidField } from '../../errors.js';

/**
 * Path parameter `:id` as a UUID: a malformed value is `400 VALIDATION_FAILED`
 * with the field (spec §5) instead of Nest's generic `400 BAD_REQUEST`.
 */
export const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () => invalidField('id', 'id must be a UUID', 'isUuid'),
});

/** An MMSI in a path: exactly nine decimal digits, no sign, exponent, prefix or spaces. */
const MMSI_PATH_PATTERN = /^\d{9}$/;

/**
 * Reads a path segment as an MMSI: exactly nine digits forming a valid MMSI
 * (contracts `isValidMmsi`), else `400 VALIDATION_FAILED` on `mmsi`.
 *
 * @throws ValidationFailedError for `-5`, `1e5`, `0x1F4A1D67`, `0525005223`,
 *   short values or values beyond the `integer` column (which `ParseIntPipe`
 *   let through to a `404` or a `500`)
 */
export function parseMmsiParam(value: unknown): number {
  const mmsi =
    typeof value === 'string' && MMSI_PATH_PATTERN.test(value)
      ? Number(value)
      : Number.NaN;
  if (!isValidMmsi(mmsi)) {
    throw invalidField('mmsi', 'mmsi must be a 9-digit MMSI', 'isMmsi');
  }
  return mmsi;
}

/**
 * The path parameter `:mmsi` as an MMSI ({@link parseMmsiParam}). A
 * parameter decorator rather than a pipe: the global `ValidationPipe`
 * converts `number` path parameters with `+value` before any parameter pipe
 * runs (`0525005223` would arrive as 525005223), while a custom decorator
 * reads the raw path segment.
 */
export const MmsiParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const params = request.params as Readonly<Record<string, unknown>>;
    return parseMmsiParam(params.mmsi);
  },
);
