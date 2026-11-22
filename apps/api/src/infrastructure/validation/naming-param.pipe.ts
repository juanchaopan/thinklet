import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import type { ApiError } from '../errors/api-error.js';

/**
 * Reads a path parameter that names something, such as an id or a code. A
 * value the schema rejects names nothing, so it is answered with the given
 * not-found error rather than as a malformed request: a guess at a path
 * learns nothing from the answer.
 */
export class NamingParamPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(
    private readonly schema: Schema,
    private readonly notFound: () => ApiError,
  ) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw this.notFound();
    }
    return result.data;
  }
}
