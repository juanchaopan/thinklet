import { bookIdSchema } from '@thinklet/contracts';
import {
  decodeCanonicalBase64,
  encodeBase64,
} from '../../infrastructure/encoding/canonical-base64.js';

/**
 * Where a book stands in the library's order (decision 0037): newest
 * `created_at` first, then by id. `createdAt` is the time as PostgreSQL
 * writes it in UTC to the microsecond, such as `2026-11-23T07:46:00.000000Z`:
 * a JavaScript Date keeps only milliseconds, and books added within one
 * millisecond would otherwise be skipped or repeated across batches.
 */
export interface BookPosition {
  createdAt: string;
  id: string;
}

/** A UTC time to the microsecond, as the book query writes `created_at`. */
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** The length of the time up to the milliseconds, without the zone: `2026-11-23T07:46:00.000`. */
const MILLISECOND_PART = 23;

/** A cursor this api makes is far shorter; anything longer is refused before decoding. */
const MAX_CURSOR_LENGTH = 200;

/** Whether the value is a real time in the form of CREATED_AT_PATTERN, not one like 02-30. */
export function isCreatedAt(value: string): boolean {
  if (!CREATED_AT_PATTERN.test(value)) {
    return false;
  }
  const milliseconds = `${value.slice(0, MILLISECOND_PART)}Z`;
  const date = new Date(milliseconds);
  return !Number.isNaN(date.getTime()) && date.toISOString() === milliseconds;
}

/** The opaque cursor of the batch after the position: base64url of `[createdAt, id]`. */
export function encodeCursor(position: BookPosition): string {
  const json = JSON.stringify([position.createdAt, position.id]);
  return encodeBase64(Buffer.from(json, 'utf8'), 'base64url');
}

/**
 * The position a cursor names, or undefined when the text is not a cursor
 * this api makes: only the exact encoding of a real time and a book id
 * passes, so a cursor cannot carry anything else into the query.
 */
export function decodeCursor(cursor: string): BookPosition | undefined {
  if (cursor.length > MAX_CURSOR_LENGTH) {
    return undefined;
  }
  const bytes = decodeCanonicalBase64(cursor, 'base64url');
  if (bytes === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }
  const [createdAt, id] = value as unknown[];
  if (typeof createdAt !== 'string' || !isCreatedAt(createdAt)) {
    return undefined;
  }
  const bookId = bookIdSchema.safeParse(id);
  if (!bookId.success) {
    return undefined;
  }
  const position = { createdAt, id: bookId.data };
  return encodeCursor(position) === cursor ? position : undefined;
}
