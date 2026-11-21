import type { PipeTransform } from '@nestjs/common';
import { familyCodeSchema, idSchema } from '@thinklet/contracts';
import { codeNotFound, requestNotFound } from './join-requests.service.js';

/**
 * Reads the join request id of the path. A value that is not an id names no
 * request, so it is answered as a request that does not exist rather than
 * as a malformed request.
 */
export class RequestIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const result = idSchema.safeParse(value);
    if (!result.success) {
      throw requestNotFound();
    }
    return result.data;
  }
}

/**
 * Reads the family code of the path in capitals, as codes are matched
 * without regard to case. A value that cannot be a code is no family's
 * code, so it is answered as an unknown code.
 */
export class FamilyCodePipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const result = familyCodeSchema.safeParse(value);
    if (!result.success) {
      throw codeNotFound();
    }
    return result.data;
  }
}
