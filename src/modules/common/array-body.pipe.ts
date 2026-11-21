import type { FieldError } from '@darmawanweb/ais-its-contracts/api';
import { ValidationFailedError } from '@darmawanweb/ais-its-nest';
import { validationErrorsToFieldErrors } from '@darmawanweb/ais-its-nest/http';
import type { PipeTransform } from '@nestjs/common';
import { type ClassConstructor, plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';

function arrayOf(value: unknown, maxItems: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationFailedError([
      {
        field: 'body',
        message: 'The body must be a JSON array',
        code: 'isArray',
      },
    ]);
  }
  if (value.length > maxItems) {
    throw new ValidationFailedError([
      {
        field: 'body',
        message: `At most ${maxItems} items`,
        code: 'arrayMaxSize',
      },
    ]);
  }
  return value;
}

/**
 * Validates a JSON array body of `itemType` objects like the global
 * validation pipe validates objects (whitelist, forbidNonWhitelisted), with
 * field paths `<index>.<property>` — the global pipe skips array bodies.
 */
export class ArrayBodyPipe<T extends object> implements PipeTransform<
  unknown,
  Promise<T[]>
> {
  constructor(
    private readonly itemType: ClassConstructor<T>,
    private readonly maxItems: number,
  ) {}

  async transform(value: unknown): Promise<T[]> {
    const items: T[] = [];
    const errors: FieldError[] = [];
    for (const [index, raw] of arrayOf(value, this.maxItems).entries()) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors.push({
          field: String(index),
          message: 'Each item must be an object',
          code: 'isObject',
        });
        continue;
      }
      const item = plainToInstance(this.itemType, raw);
      const found = await validate(item, {
        whitelist: true,
        forbidNonWhitelisted: true,
        validationError: { target: false, value: false },
      });
      errors.push(...validationErrorsToFieldErrors(found, String(index)));
      items.push(item);
    }
    if (errors.length > 0) throw new ValidationFailedError(errors);
    return items;
  }
}

/** Validates a JSON array body of unique UUID strings. */
export class UuidArrayBodyPipe implements PipeTransform<unknown, string[]> {
  constructor(private readonly maxItems: number) {}

  transform(value: unknown): string[] {
    const items = arrayOf(value, this.maxItems);
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (typeof item !== 'string' || !isUUID(item)) {
        errors.push({
          field: String(index),
          message: 'Must be a UUID',
          code: 'isUuid',
        });
      } else if (seen.has(item)) {
        errors.push({
          field: String(index),
          message: 'Listed twice',
          code: 'arrayUnique',
        });
      } else {
        seen.add(item);
      }
    });
    if (errors.length > 0) throw new ValidationFailedError(errors);
    return [...seen];
  }
}
