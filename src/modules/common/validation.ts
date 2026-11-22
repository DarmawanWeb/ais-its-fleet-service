import { PageQueryDto } from '@darmawanweb/ais-its-nest/http';
import type { Type as ClassType } from '@nestjs/common';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, type TransformFnParams, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

import { checkFuelFormula } from '../../domain/fuel-formula.js';

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
 * Validates a first-fuel-formula string against the safe grammar of
 * `domain/fuel-formula.ts`; the message names the problem and its position.
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
          typeof value === 'string' && checkFuelFormula(value).valid,
        defaultMessage: (args: ValidationArguments) => {
          const value: unknown = args.value;
          if (typeof value !== 'string')
            return `${args.property} must be a string`;
          const check = checkFuelFormula(value);
          return check.valid
            ? `${args.property} is valid`
            : `${args.property} is not a safe fuel formula: ${check.message}`;
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
 * A member that may be absent but is never `null` (a NOT NULL column):
 * validation is skipped only when the value is `undefined`, so `null` fails
 * the member's other validators with `400 VALIDATION_FAILED`.
 * `@IsOptional()` skips `null` as well — use it only for nullable members.
 */
export function IsOptionalNonNull(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateIf(
    (_object: object, value: unknown) => value !== undefined,
    options,
  );
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
 * Highest accepted `page`: keeps `(page − 1) · pageSize` far inside the
 * range of a PostgreSQL `bigint` OFFSET (the kit's `PageQueryDto` has no
 * upper bound, so a huge page was a `500` instead of a `400`).
 */
export const MAX_PAGE = 1_000_000;

/**
 * The kit's page query (`page` ≥ 1, `pageSize` 1–100) with `page` ≤
 * {@link MAX_PAGE}; base of every page-based list of the service.
 */
export class BoundedPageQueryDto extends PageQueryDto {
  // Re-declares every validator of `page`: class-validator replaces the
  // inherited constraints of a member that the subclass decorates.
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE,
    default: 1,
    type: 'integer',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  override readonly page: number = 1;
}

/** Query of the reference-data lists: page + case-insensitive name/code search. */
export class ReferenceListQuery extends BoundedPageQueryDto {
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
