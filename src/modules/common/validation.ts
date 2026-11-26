import {
  isValidMmsi,
  validateFuelFormula,
} from '@darmawanweb/ais-its-contracts/domain';
import { getReference } from '@darmawanweb/ais-its-contracts/references';
import { PageQueryDto } from '@darmawanweb/ais-its-nest/http';
import type { Type as ClassType } from '@nestjs/common';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/** Codes of reference rows: lowercase snake case, e.g. `bulk_carrier_279k_plus`. */
export const CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** Trims string input before validation (other values pass unchanged). */
export function trimString(params: TransformFnParams): unknown {
  const input: unknown = params.value;
  return typeof input === 'string' ? input.trim() : input;
}

/** Upper-cases and trims string input (codes such as flags and port codes). */
export function upperTrimString(params: TransformFnParams): unknown {
  const input: unknown = params.value;
  return typeof input === 'string' ? input.trim().toUpperCase() : input;
}

/**
 * Validates a first-fuel-formula string against the safe grammar shared with
 * the emission service (contracts `validateFuelFormula`, default
 * `FUEL_FORMULA_LIMITS`: 500 characters, depth 32, 500 tokens, finite
 * literals): emission evaluates the strings stored here, so nothing outside
 * the grammar is written. The message names the problem and its position.
 *
 * @method fuel.first_formula
 */
export function IsFuelFormula(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isFuelFormula',
      target: target.constructor,
      propertyName: String(propertyName),
      ...(options === undefined ? {} : { options }),
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && validateFuelFormula(value).valid,
        defaultMessage: (args: ValidationArguments) => {
          const value: unknown = args.value;
          if (typeof value !== 'string')
            return `${args.property} must be a string`;
          const check = validateFuelFormula(value);
          return check.valid
            ? `${args.property} is valid`
            : `${args.property} is not a safe fuel formula: ${check.errors[0].message}`;
        },
      },
    });
  };
}

/**
 * Validates that the numeric members `keys` of an object are strictly
 * increasing (CII rating boundaries d1 < d2 < d3 < d4).
 */
export function IsStrictlyIncreasing(
  keys: readonly string[],
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isStrictlyIncreasing',
      target: target.constructor,
      propertyName: String(propertyName),
      ...(options === undefined ? {} : { options }),
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null) return true;
          const record = value as Record<string, unknown>;
          const numbers = keys.map((key) => record[key]);
          // Types of the members are checked by their own decorators.
          if (!numbers.every((n): n is number => typeof n === 'number'))
            return true;
          return numbers.every(
            (n, index) => index === 0 || n > (numbers[index - 1] ?? n),
          );
        },
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must satisfy ${keys.join(' < ')}`,
      },
    });
  };
}

/**
 * A comma-separated query value as its trimmed items (`a,b` or a repeated
 * parameter `?x=a&x=b`); other values pass unchanged.
 */
export function splitList(params: TransformFnParams): unknown {
  const input: unknown = params.value;
  const parts = Array.isArray(input) ? input : [input];
  if (!parts.every((part): part is string => typeof part === 'string'))
    return input;
  return parts.flatMap((part) => part.split(',')).map((part) => part.trim());
}

/** Nine decimal digits forming an MMSI (no sign, exponent, prefix or spaces). */
const MMSI_TEXT = /^\d{9}$/;

/**
 * A list of 1–`max` MMSIs as nine-digit strings (after {@link splitList}),
 * each a valid MMSI (contracts `isValidMmsi`): `0525005223`, `52500522` or
 * `5250052e2` are refused, never converted.
 */
export function IsMmsiList(
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isMmsiList',
      target: target.constructor,
      propertyName: String(propertyName),
      ...(options === undefined ? {} : { options }),
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) &&
          value.length >= 1 &&
          value.length <= max &&
          value.every(
            (item) =>
              typeof item === 'string' &&
              MMSI_TEXT.test(item) &&
              isValidMmsi(Number(item)),
          ),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a comma-separated list of 1–${max} nine-digit MMSIs`,
      },
    });
  };
}

/** Most reference ids one reference row cites (also a CHECK in the tables). */
export const MAX_REFERENCE_IDS = 20;

/** OpenAPI description of `referenceIds`. */
export const REFERENCE_IDS_DESCRIPTION =
  "Ids of the methodology catalog's references (docs/references/references.json, contracts REFERENCES) behind the values, next to the free-text `source`; " +
  `unique, at most ${MAX_REFERENCE_IDS}, each a reference of the catalog this service ships (else 400 VALIDATION_FAILED). [] clears them, null is refused.`;

/**
 * An id of the methodology catalog's references (contracts `getReference`):
 * validate arrays with `{ each: true }`.
 */
export function IsCatalogReference(
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isCatalogReference',
      target: target.constructor,
      propertyName: String(propertyName),
      ...(options === undefined ? {} : { options }),
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && getReference(value) !== undefined,
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must hold ids of the methodology catalog's references (unknown: ${JSON.stringify(args.value)})`,
      },
    });
  };
}

/** `[longitude, latitude]` in WGS 84 degrees. */
export function IsLonLat(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isLonLat',
      target: target.constructor,
      propertyName: String(propertyName),
      ...(options === undefined ? {} : { options }),
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) &&
          value.length === 2 &&
          typeof value[0] === 'number' &&
          typeof value[1] === 'number' &&
          value[0] >= -180 &&
          value[0] <= 180 &&
          value[1] >= -90 &&
          value[1] <= 90,
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be [longitude, latitude] with longitude in [-180, 180] and latitude in [-90, 90]`,
      },
    });
  };
}

/**
 * `PartialType` for PATCH bodies: every member of `classRef` becomes
 * optional, but a member that is present is validated, `null` included.
 * `null` therefore passes only for members the create DTO marks
 * `@IsOptional()` (nullable columns, where it clears the value); for every
 * other member it is `400 VALIDATION_FAILED` instead of reaching a NOT NULL
 * column. (`PartialType`'s default adds `@IsOptional()` to every member,
 * which lets `null` through everywhere.)
 */
export function PatchType<T>(classRef: ClassType<T>): ClassType<Partial<T>> {
  return PartialType(classRef, { skipNullProperties: false });
}

/**
 * Query of the reference-data lists: the kit's page query (`page`
 * 1–`MAX_PAGE`, `pageSize` 1–100) + case-insensitive name/code search.
 */
export class ReferenceListQuery extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring of the name or code',
    maxLength: 120,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  readonly search?: string;
}

/** Escapes `%`, `_` and `\` so user input matches literally in LIKE patterns. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
