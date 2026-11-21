import { PageQueryDto } from '@darmawanweb/ais-its-nest/http';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  registerDecorator,
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

/** Query of the reference-data lists: page + case-insensitive name/code search. */
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
