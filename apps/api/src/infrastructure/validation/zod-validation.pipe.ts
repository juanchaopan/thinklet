import { HttpStatus, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { toFieldErrors, type FieldError } from '@thinklet/contracts';
import type { z } from 'zod';
import { ApiError } from '../errors/api-error.js';

/** The rejected fields under the name of the argument they belong to, when it has one. */
function underArgument(fields: FieldError[], name: string | undefined): FieldError[] {
  if (name === undefined) {
    return fields;
  }
  return fields.map(({ path, code }) => ({ path: path === '' ? name : `${name}.${path}`, code }));
}

/**
 * Validates a request body (or any other argument) with a schema from
 * `packages/contracts` and hands the parsed value to the handler. A value
 * the schema rejects is answered with 400 `invalid_request` and the rejected
 * fields with their codes. A named argument, such as `@Param('parentId')`,
 * reports its fields under its name, so a rejected path parameter is
 * `parentId` rather than the empty root path.
 */
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown, metadata?: ArgumentMetadata): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(
        'invalid_request',
        HttpStatus.BAD_REQUEST,
        underArgument(toFieldErrors(result.error), metadata?.data),
      );
    }
    return result.data;
  }
}
