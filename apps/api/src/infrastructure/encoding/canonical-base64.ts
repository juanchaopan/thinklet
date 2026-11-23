/**
 * The forms of base64 the api reads and writes: standard base64 with its
 * padding, standard base64 without it (as PHC strings carry it), and
 * unpadded base64url.
 */
export type Base64Form = 'base64' | 'base64-unpadded' | 'base64url';

/** The bytes written in the form. */
export function encodeBase64(bytes: Buffer, form: Base64Form): string {
  if (form === 'base64url') {
    return bytes.toString('base64url');
  }
  const padded = bytes.toString('base64');
  return form === 'base64' ? padded : padded.replace(/=+$/, '');
}

/**
 * The text decoded into bytes, only when the text is the canonical encoding
 * of those bytes in the form; otherwise undefined. Node's decoder skips
 * characters it does not know, takes either alphabet and stops at the first
 * `=`, so text with stray characters, in the other alphabet, cut off or with
 * the wrong padding would otherwise decode into other bytes.
 */
export function decodeCanonicalBase64(text: string, form: Base64Form): Buffer | undefined {
  const bytes = Buffer.from(text, form === 'base64url' ? 'base64url' : 'base64');
  return encodeBase64(bytes, form) === text ? bytes : undefined;
}
