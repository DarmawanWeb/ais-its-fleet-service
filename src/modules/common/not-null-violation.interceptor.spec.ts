import { ValidationFailedError } from '@darmawanweb/ais-its-nest';
import { PG_SQLSTATES } from '@darmawanweb/ais-its-nest/db';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import {
  camelCaseColumn,
  NotNullViolationInterceptor,
} from './not-null-violation.interceptor.js';

const context = {} as ExecutionContext;

function handlerThrowing(error: unknown): CallHandler {
  return { handle: () => throwError(() => error) };
}

describe('NotNullViolationInterceptor', () => {
  const interceptor = new NotNullViolationInterceptor();

  it('answers a NOT NULL violation as 400 VALIDATION_FAILED on the field', async () => {
    // As pg's DatabaseError carries it (severity, code, column).
    const driver = Object.assign(new Error('null value in column'), {
      severity: 'ERROR',
      code: PG_SQLSTATES.NOT_NULL_VIOLATION,
      column: 'annual_voyage_percentage',
    });
    const wrapped = new Error('Failed query', { cause: driver });
    const result = lastValueFrom(
      interceptor.intercept(context, handlerThrowing(wrapped)),
    );
    await expect(result).rejects.toBeInstanceOf(ValidationFailedError);
    await expect(result).rejects.toMatchObject({
      errors: [
        {
          field: 'annualVoyagePercentage',
          message: 'annualVoyagePercentage must not be null',
          code: 'isNotNull',
        },
      ],
    });
  });

  it('passes other errors and results through unchanged', async () => {
    const other = new Error('boom');
    await expect(
      lastValueFrom(interceptor.intercept(context, handlerThrowing(other))),
    ).rejects.toBe(other);
    await expect(
      lastValueFrom(interceptor.intercept(context, { handle: () => of(42) })),
    ).resolves.toBe(42);
  });

  it('camel-cases column names', () => {
    expect(camelCaseColumn('main_engine_formula')).toBe('mainEngineFormula');
    expect(camelCaseColumn('d1')).toBe('d1');
  });
});
