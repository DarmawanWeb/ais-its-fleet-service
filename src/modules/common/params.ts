import { ParseUUIDPipe } from '@nestjs/common';

import { invalidField } from '../../errors.js';

/**
 * Path parameter `:id` as a UUID: a malformed value is `400 VALIDATION_FAILED`
 * with the field (spec §5) instead of Nest's generic `400 BAD_REQUEST`.
 */
export const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () => invalidField('id', 'id must be a UUID', 'isUuid'),
});
