import type { PipeTransform } from '@nestjs/common';
import { idSchema } from '@thinklet/contracts';
import { NamingParamPipe } from '../../infrastructure/validation/naming-param.pipe.js';
import { familyNotFound } from '../family/families.service.js';
import { childNotFound, linkNotFound } from './children.service.js';

// The ids in the paths of the children routes. A value that is not an id
// names nothing, so it is answered as the thing it would name not being
// there, never as a malformed request.

/** The family id of the path; one that is not an id is a family that does not exist. */
export const familyIdPipe = new NamingParamPipe(idSchema, familyNotFound);

/** The child id of the path; one that is not an id is a child the family does not have. */
export const childIdPipe = new NamingParamPipe(idSchema, childNotFound);

/** The login link id of the path; one that is not an id is a link the child does not have. */
export const linkIdPipe = new NamingParamPipe(idSchema, linkNotFound);

/**
 * The device id of the path, or undefined when it is not an id. Revoking a
 * device that is not there is no error, so such a value is not one either.
 */
export const deviceIdPipe: PipeTransform<unknown, string | undefined> = {
  transform: (value) => {
    const result = idSchema.safeParse(value);
    return result.success ? result.data : undefined;
  },
};
