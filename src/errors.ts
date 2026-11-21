import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '@darmawanweb/ais-its-nest';

/**
 * Errors of the fleet service. Every class carries a stable code and maps to
 * RFC 9457 problem details through the kit's filter (spec §5); shared codes
 * come from contracts `ERROR_DEFINITIONS`, the others are documented in the
 * README.
 */

/** Reference resources of the service, as named in error codes and messages. */
export type FleetResource =
  'vessel_type' | 'fuel' | 'engine' | 'fuel_formula' | 'port';

const RESOURCE_LABELS: Readonly<Record<FleetResource, string>> = {
  vessel_type: 'vessel type',
  fuel: 'fuel',
  engine: 'engine',
  fuel_formula: 'fuel formula',
  port: 'port',
};

/** `404 VESSEL_NOT_FOUND`. */
export class VesselNotFoundError extends NotFoundError {
  constructor(key: { readonly id: string } | { readonly mmsi: number }) {
    super(
      'id' in key
        ? `No vessel with id ${key.id}`
        : `No vessel with MMSI ${key.mmsi}`,
      { code: 'VESSEL_NOT_FOUND', extra: { ...key } },
    );
  }
}

/** `404 <RESOURCE>_NOT_FOUND`, e.g. `FUEL_NOT_FOUND`. */
export class ReferenceNotFoundError extends NotFoundError {
  constructor(resource: FleetResource, id: string) {
    super(`No ${RESOURCE_LABELS[resource]} with id ${id}`, {
      code: `${resource.toUpperCase()}_NOT_FOUND`,
      extra: { id },
    });
  }
}

/** `404 REGISTRY_ENTRY_NOT_FOUND`. */
export class RegistryEntryNotFoundError extends NotFoundError {
  constructor(key: string) {
    super(`No registry particulars for ${key}`, {
      code: 'REGISTRY_ENTRY_NOT_FOUND',
      extra: { key },
    });
  }
}

/** `409 REFERENCE_IN_USE`: reference data still used by vessels. */
export class ReferenceInUseError extends ConflictError {
  constructor(resource: FleetResource, id: string, vessels: number) {
    super(
      `The ${RESOURCE_LABELS[resource]} ${id} is used by ${vessels} vessel(s); reassign them first`,
      { code: 'REFERENCE_IN_USE', extra: { resource, id, vessels } },
    );
  }
}

/** `409 CODE_ALREADY_EXISTS`: the unique code of a reference row is taken. */
export class CodeTakenError extends ConflictError {
  constructor(resource: FleetResource, code: string, cause?: unknown) {
    super(`A ${RESOURCE_LABELS[resource]} with code "${code}" already exists`, {
      code: 'CODE_ALREADY_EXISTS',
      extra: { resource, code },
      cause,
    });
  }
}

/** `409 MMSI_ALREADY_EXISTS`. */
export class MmsiTakenError extends ConflictError {
  constructor(mmsi: number, cause?: unknown) {
    super(`MMSI ${mmsi} is already registered`, {
      code: 'MMSI_ALREADY_EXISTS',
      extra: { mmsi },
      cause,
    });
  }
}

/** `409 IMO_ALREADY_EXISTS`. */
export class ImoTakenError extends ConflictError {
  constructor(imo: string, cause?: unknown) {
    super(`IMO ${imo} is already registered`, {
      code: 'IMO_ALREADY_EXISTS',
      extra: { imo },
      cause,
    });
  }
}

/** `403 ORGANIZATION_REQUIRED`: the principal has no active organization. */
export class OrganizationRequiredError extends ForbiddenError {
  constructor() {
    super('Select an organization to manage its vessels', {
      code: 'ORGANIZATION_REQUIRED',
    });
  }
}

/** `403 FORBIDDEN`: the vessel or the organization belongs to another tenant. */
export class ForeignOrganizationError extends ForbiddenError {
  constructor(detail = 'The vessel belongs to another organization') {
    super(detail);
  }
}

/** `403 PLATFORM_ADMIN_REQUIRED`: the operation is reserved to `super_admin`. */
export class PlatformAdminRequiredError extends ForbiddenError {
  constructor(operation: string) {
    super(`Only platform administrators may ${operation}`, {
      code: 'PLATFORM_ADMIN_REQUIRED',
    });
  }
}

/** `400 VALIDATION_FAILED` for one field (e.g. an unknown referenced id). */
export function invalidField(
  field: string,
  message: string,
  code: string,
): ValidationFailedError {
  return new ValidationFailedError([{ field, message, code }]);
}

/** `413 PAYLOAD_TOO_LARGE`. */
export class PhotoTooLargeError extends DomainError {
  constructor(maxBytes: number) {
    super('PAYLOAD_TOO_LARGE', {
      detail: `Photos are limited to ${maxBytes} bytes`,
      extra: { maxBytes },
    });
  }
}

/** `415 UNSUPPORTED_MEDIA_TYPE`: not a JPEG, PNG or WebP image. */
export class UnsupportedPhotoError extends DomainError {
  constructor(detail: string) {
    super('UNSUPPORTED_MEDIA_TYPE', {
      detail,
      extra: { accepted: ['image/jpeg', 'image/png', 'image/webp'] },
    });
  }
}

/** `404 PHOTO_NOT_FOUND`: the vessel has no photo. */
export class PhotoNotFoundError extends NotFoundError {
  constructor(vesselId: string) {
    super(`Vessel ${vesselId} has no photo`, {
      code: 'PHOTO_NOT_FOUND',
      extra: { vesselId },
    });
  }
}
