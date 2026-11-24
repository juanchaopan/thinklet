import * as z from 'zod';
import './runtime.js';

/**
 * Why a request field was rejected. The schemas below use these codes as
 * their issue messages, so the api can report them in `fields` and the web
 * app can show the field's hint from the same validation before submitting.
 */
export const fieldErrorCodeSchema = z.enum(['required', 'too_short', 'too_long', 'invalid']);

export type FieldErrorCode = z.infer<typeof fieldErrorCodeSchema>;

/** Missing values are `required`; values of the wrong type are `invalid`. */
function requiredOrInvalid(issue: { input?: unknown }): FieldErrorCode {
  return issue.input === undefined ? 'required' : 'invalid';
}

/** The id of a parent, a family, a child or a join request given in a request. */
export const idSchema = z.uuid({ error: requiredOrInvalid });

/** A yes-or-no choice of a request, such as remembering the device at login. */
export const booleanFieldSchema = z.boolean({ error: requiredOrInvalid });

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const utf8 = new TextEncoder();

/**
 * The number of characters as a reader counts them: user-perceived
 * characters (grapheme clusters), so an emoji or a letter with an accent
 * counts once, however many UTF-16 code units or code points it takes.
 */
export function characterCount(value: string): number {
  return Array.from(graphemes.segment(value)).length;
}

/** The number of bytes the value takes in UTF-8, as the database stores it. */
export function utf8Length(value: string): number {
  return utf8.encode(value).length;
}

/**
 * The first `max` characters of the value, never splitting a character.
 * With `maxBytes`, it also stops before the character that would take the
 * result past that many bytes of UTF-8.
 */
export function truncateCharacters(
  value: string,
  max: number,
  maxBytes = Number.POSITIVE_INFINITY,
): string {
  const kept: string[] = [];
  let bytes = 0;
  for (const { segment } of graphemes.segment(value)) {
    bytes += utf8Length(segment);
    if (kept.length === max || bytes > maxBytes) {
      break;
    }
    kept.push(segment);
  }
  return kept.join('');
}

/**
 * How many bytes of UTF-8 a name may take for each character it may have
 * (`.docs/design/rules.md`, "家长账号"). Ordinary text never comes near it;
 * it stops a few visible characters from carrying long runs of combining
 * marks into storage.
 */
const BYTES_PER_CHARACTER = 16;

/** The most characters a family name or a parent name may have. */
export const NAME_MAX_LENGTH = 20;

/** The most bytes of UTF-8 a family name or a parent name may take: 320. */
export const NAME_MAX_BYTES = NAME_MAX_LENGTH * BYTES_PER_CHARACTER;

/** The most characters a child's nickname may have. */
export const NICKNAME_MAX_LENGTH = 10;

/** The most bytes of UTF-8 a child's nickname may take: 160. */
export const NICKNAME_MAX_BYTES = NICKNAME_MAX_LENGTH * BYTES_PER_CHARACTER;

/**
 * A display name: trimmed, then 1 to `max` characters of any kind and at
 * most `maxBytes` bytes. Too many bytes is reported as too long, like too
 * many characters, so the hint is the same; the bytes are counted first,
 * which bounds the work of counting the characters of a huge value.
 */
function nameSchema(max: number, maxBytes: number) {
  return z
    .string({ error: requiredOrInvalid })
    .trim()
    .refine((value) => value.length > 0, { error: 'required' })
    .refine((value) => utf8Length(value) <= maxBytes && characterCount(value) <= max, {
      error: 'too_long',
    });
}

/** The name of a family. */
export const familyNameSchema = nameSchema(NAME_MAX_LENGTH, NAME_MAX_BYTES);

/** The name a parent is shown by. */
export const parentNameSchema = nameSchema(NAME_MAX_LENGTH, NAME_MAX_BYTES);

/** The name a child is shown by; children of a family may share one. */
export const childNicknameSchema = nameSchema(NICKNAME_MAX_LENGTH, NICKNAME_MAX_BYTES);

/** The most characters a child's account may have. */
export const CHILD_ACCOUNT_MAX_LENGTH = 20;

const childAccountPattern = /^[a-z0-9]+$/;

/**
 * What is wrong with a trimmed account, if anything. Exactly one code
 * comes out, so an account that is both too long and has other characters
 * is reported by its characters, which the input box keeps out first.
 */
function childAccountError(value: string): FieldErrorCode | undefined {
  if (value.length === 0) {
    return 'required';
  }
  if (!childAccountPattern.test(value)) {
    return 'invalid';
  }
  return value.length > CHILD_ACCOUNT_MAX_LENGTH ? 'too_long' : undefined;
}

/**
 * The account a child logs in with, unique within the family: trimmed,
 * then 1 to 20 lower-case letters a–z and digits. Capitals are rejected
 * rather than lowered, because the input box lowers them as they are typed.
 */
export const childAccountSchema = z
  .string({ error: requiredOrInvalid })
  .trim()
  .superRefine((value, context) => {
    const code = childAccountError(value);
    if (code !== undefined) {
      context.addIssue({ code: 'custom', message: code });
    }
  });

/** The fewest and the most characters a child's password may have. */
export const CHILD_PASSWORD_MIN_LENGTH = 6;
export const CHILD_PASSWORD_MAX_LENGTH = 32;

/** The most bytes of UTF-8 a child's password may take. */
export const CHILD_PASSWORD_MAX_BYTES = 128;

/**
 * Whether a password is no longer than a child's password may be: at most
 * 32 characters and 128 bytes. A longer one is never hashed, so the cost of
 * hashing does not grow with what a request sends. The bytes are counted
 * first, which bounds the work of counting the characters.
 */
export function withinChildPasswordLimits(value: string): boolean {
  return (
    utf8Length(value) <= CHILD_PASSWORD_MAX_BYTES &&
    characterCount(value) <= CHILD_PASSWORD_MAX_LENGTH
  );
}

/**
 * A password a child sets: 6 to 32 characters of any kind, spaces
 * included, counted as a reader counts them and never trimmed, and at most
 * 128 bytes. Too many bytes is reported as too long, like too many
 * characters.
 */
export const newChildPasswordSchema = z
  .string({ error: requiredOrInvalid })
  .refine((value) => value.length > 0, { error: 'required' })
  .refine((value) => value.length === 0 || characterCount(value) >= CHILD_PASSWORD_MIN_LENGTH, {
    error: 'too_short',
  })
  .refine(withinChildPasswordLimits, { error: 'too_long' });

/**
 * A password a child logs in with: anything but empty. Its length is not
 * checked here, so a password of the wrong length is simply a wrong
 * password and the login answers as for any other; the api refuses one
 * past the limits without hashing it.
 */
export const childPasswordSchema = z
  .string({ error: requiredOrInvalid })
  .refine((value) => value.length > 0, { error: 'required' });

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
 * Zones IANA has renamed whose old names Intl still resolves to: its time
 * zone data comes from CLDR, which keeps the first name a zone had. Each
 * old name is an alias of the new one, so the zone is shown, saved and
 * compared by the new name everywhere.
 */
const RENAMED_TIME_ZONES: ReadonlyMap<string, string> = new Map([
  ['Africa/Asmera', 'Africa/Asmara'],
  ['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
  ['America/Catamarca', 'America/Argentina/Catamarca'],
  ['America/Cordoba', 'America/Argentina/Cordoba'],
  ['America/Godthab', 'America/Nuuk'],
  ['America/Indianapolis', 'America/Indiana/Indianapolis'],
  ['America/Jujuy', 'America/Argentina/Jujuy'],
  ['America/Louisville', 'America/Kentucky/Louisville'],
  ['America/Mendoza', 'America/Argentina/Mendoza'],
  ['Asia/Calcutta', 'Asia/Kolkata'],
  ['Asia/Katmandu', 'Asia/Kathmandu'],
  ['Asia/Rangoon', 'Asia/Yangon'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
  ['Atlantic/Faeroe', 'Atlantic/Faroe'],
  ['Europe/Kiev', 'Europe/Kyiv'],
  ['Pacific/Enderbury', 'Pacific/Kanton'],
  ['Pacific/Ponape', 'Pacific/Pohnpei'],
  ['Pacific/Truk', 'Pacific/Chuuk'],
]);

/**
 * The standard name of a time zone (`.docs/design/rules.md`, "家庭"):
 * aliases Intl knows become the name it resolves them to ("US/Pacific" is
 * "America/Los_Angeles"), and the old names IANA renamed become the new
 * ones ("Asia/Calcutta" is "Asia/Kolkata"). Null when Intl does not know
 * the zone at all.
 */
export function canonicalTimeZone(name: string): string | null {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return RENAMED_TIME_ZONES.get(resolved) ?? resolved;
}

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

/** An IANA time zone name; an alias comes out as the standard name it stands for. */
export const timeZoneSchema = z
  .string({ error: requiredOrInvalid })
  .refine((value) => value.length > 0, { error: 'required' })
  .refine((value) => value.length === 0 || isTimeZone(value), { error: 'invalid' })
  .transform((value) => canonicalTimeZone(value) ?? value);
