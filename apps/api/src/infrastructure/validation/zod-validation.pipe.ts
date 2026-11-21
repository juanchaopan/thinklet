import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { toFieldErrors } from '@thinklet/contracts';
import type { z } from 'zod';
import { ApiError } from '../errors/api-error.js';

/**
 * Validates a request body (or any other argument) with a schema from
 * `packages/contracts` and hands the parsed value to the handler. A value
 * the schema rejects is answered with 400 `invalid_request` and the rejected
 * fields with their codes.
 */
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError('invalid_request', HttpStatus.BAD_REQUEST, toFieldErrors(result.error));
    }
    return result.data;
  }
}
