import { z } from 'zod';

/**
 * Why a request field was rejected. The schemas below use these codes as
 * their issue messages, so the api can report them in `fields` and the web
 * app can show the field's hint from the same validation before submitting.
 */
export const fieldErrorCodeSchema = z.enum(['required', 'too_long', 'invalid']);

export type FieldErrorCode = z.infer<typeof fieldErrorCodeSchema>;

/** Missing values are `required`; values of the wrong type are `invalid`. */
function requiredOrInvalid(issue: { input?: unknown }): FieldErrorCode {
  return issue.input === undefined ? 'required' : 'invalid';
}

/** The id of a parent, a family or a join request given in a request. */
export const idSchema = z.uuid({ error: requiredOrInvalid });

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The number of characters as a reader counts them: user-perceived
 * characters (grapheme clusters), so an emoji or a letter with an accent
 * counts once, however many UTF-16 code units or code points it takes.
 */
export function characterCount(value: string): number {
  return Array.from(graphemes.segment(value)).length;
}

/** The first `max` characters of the value, never splitting a character. */
export function truncateCharacters(value: string, max: number): string {
  return Array.from(graphemes.segment(value))
    .slice(0, max)
    .map(({ segment }) => segment)
    .join('');
}

/** The most characters a family name or a parent name may have. */
export const NAME_MAX_LENGTH = 20;

/** A display name: trimmed, then 1 to 20 characters of any kind. */
function nameSchema() {
  return z
    .string({ error: requiredOrInvalid })
    .trim()
    .refine((value) => characterCount(value) >= 1, { error: 'required' })
    .refine((value) => characterCount(value) <= NAME_MAX_LENGTH, { error: 'too_long' });
}

/** The name of a family. */
export const familyNameSchema = nameSchema();

/** The name a parent is shown by. */
export const parentNameSchema = nameSchema();

/** The characters of a family code: digits and capital letters without 0, O, 1, I and L. */
export const FAMILY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** The number of characters in a family code. */
export const FAMILY_CODE_LENGTH = 6;

const familyCodePattern = new RegExp(`^[${FAMILY_CODE_ALPHABET}]{${FAMILY_CODE_LENGTH}}$`);

/** A family code; input is case-insensitive and comes out in capitals. */
export const familyCodeSchema = z
  .string({ error: requiredOrInvalid })
  .toUpperCase()
  .regex(familyCodePattern, { error: 'invalid' });

/**
 * The shape of an IANA time zone name ("Asia/Shanghai", "UTC", "Etc/GMT+8").
 * It keeps out the offsets ("+08:00") that Intl also accepts as time zones.
 */
const timeZoneNamePattern = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * Whether the value is an IANA time zone name that Intl knows. Intl is asked
 * directly rather than through `Intl.supportedValuesOf('timeZone')`, whose
 * list leaves out names such as "UTC" that a browser reports as its own time
 * zone. Intl matches names case-insensitively, so a name that differs from
 * Intl's spelling only in case is rejected.
 */
export function isTimeZone(value: string): boolean {
  if (!timeZoneNamePattern.test(value)) {
    return false;
  }
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return false;
  }
  return resolved === value || resolved.toLowerCase() !== value.toLowerCase();
}

/** An IANA time zone name. */
export const timeZoneSchema = z
  .string({ error: requiredOrInvalid })
  .refine((value) => value.length > 0, { error: 'required' })
  .refine((value) => value.length === 0 || isTimeZone(value), { error: 'invalid' });
