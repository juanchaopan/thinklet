import { randomInt } from 'node:crypto';
import { FAMILY_CODE_ALPHABET, FAMILY_CODE_LENGTH } from '@thinklet/contracts';

/** A uniformly random whole number from 0 up to, but not including, `max`. */
export type RandomIndex = (max: number) => number;

/**
 * A new family code: six characters drawn independently and uniformly from
 * the family code alphabet (`.docs/design/rules.md`, "家庭"). Children sign
 * in with the code, so it is drawn with Node's cryptographically secure
 * generator, whose `randomInt` has no modulo bias. Uniqueness across the
 * platform is the database's to check.
 */
export function generateFamilyCode(randomIndex: RandomIndex = randomInt): string {
  let code = '';
  for (let position = 0; position < FAMILY_CODE_LENGTH; position += 1) {
    code += FAMILY_CODE_ALPHABET.charAt(randomIndex(FAMILY_CODE_ALPHABET.length));
  }
  return code;
}
