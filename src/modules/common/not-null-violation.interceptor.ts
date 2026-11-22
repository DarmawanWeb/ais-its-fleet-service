import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, type Observable, throwError } from 'rxjs';

import { notNullViolationColumn } from '../../db/errors.js';
import { invalidField } from '../../errors.js';

/** `annual_voyage_percentage` → `annualVoyagePercentage`. */
export function camelCaseColumn(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_match, next: string) =>
    next.toUpperCase(),
  );
}

/**
 * Second safeguard behind DTO validation (`IsOptionalNonNull`, `PatchType`):
 * a PostgreSQL NOT NULL violation (`null` sent for a required column) is
 * answered `400 VALIDATION_FAILED` on the column's field instead of `500`
 * (spec §5). It is logged as a warning, because it means a DTO lets `null`
 * through where it should not.
 */
@Injectable()
export class NotNullViolationInterceptor implements NestInterceptor {
  private readonly logger = new Logger('NotNullViolation');

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const column = notNullViolationColumn(error);
        if (column === undefined) return throwError(() => error);
        const field = camelCaseColumn(column);
        this.logger.warn(
          `NOT NULL violation on column ${column} answered as 400: a DTO lets null through for ${field}`,
        );
        return throwError(() =>
          invalidField(field, `${field} must not be null`, 'isNotNull'),
        );
      }),
    );
  }
}
