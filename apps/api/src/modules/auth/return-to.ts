/** Where a login returns to when it was given no page, or one it may not go to. */
export const DEFAULT_RETURN_TO = '/';

/**
 * The longest page address kept; the address travels in the login cookie,
 * which has to stay well under the browsers' cookie size limit.
 */
const MAX_LENGTH = 2_000;

// Control characters, which browsers strip from or reject in a URL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** An origin no path can name, to resolve a path against. */
const PROBE_ORIGIN = 'https://return-to.invalid';

/**
 * The page a login returns to: the given value when it is a path on this
 * site, else `/`. Only a path that starts with a single `/` is accepted;
 * `//host` and `/\host` (which browsers read as another site), absolute
 * URLs, backslashes, control characters and over-long values fall back to
 * `/`, so the login can never redirect to another site.
 */
export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_LENGTH ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return DEFAULT_RETURN_TO;
  }
  return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN ? value : DEFAULT_RETURN_TO;
}
