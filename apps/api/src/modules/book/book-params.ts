import type { PipeTransform } from '@nestjs/common';
import { bookIdSchema, idSchema } from '@thinklet/contracts';
import { NamingParamPipe } from '../../infrastructure/validation/naming-param.pipe.js';
import { familyNotFound } from '../family/families.service.js';
import { coverNotFound } from './cover.service.js';
import { bookNotFound } from './library.service.js';

// The ids in the paths of the book routes. A value of the wrong shape
// names nothing, so it is answered as the thing it would name not being
// there, never as a malformed request.

/** The family id of the path; one that is not an id is a family that does not exist. */
export const familyIdPipe = new NamingParamPipe(idSchema, familyNotFound);

/** The book id of a family's book route; one that is not a book id is a book that does not exist. */
export const bookIdPipe = new NamingParamPipe(bookIdSchema, bookNotFound);

/** The book id of a cover's route; one that is not a book id is a cover that does not exist. */
export const coverBookIdPipe = new NamingParamPipe(bookIdSchema, coverNotFound);

/**
 * The `v` of a cover's address, the cover's SHA-256, or undefined when it
 * is missing or given more than once. It is only ever compared with the
 * hash in the book table, so any other value is a cover that does not
 * exist rather than a malformed request.
 */
export const coverVersionPipe: PipeTransform<unknown, string | undefined> = {
  transform: (value) => (typeof value === 'string' ? value : undefined),
};
