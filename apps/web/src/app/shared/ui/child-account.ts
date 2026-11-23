import { CHILD_ACCOUNT_MAX_LENGTH } from '@thinklet/contracts';

/** What every box for a child's account says under it (rules.md, 孩子). */
export const CHILD_ACCOUNT_HINT = '孩子登录时输入，只能用小写字母和数字';

/**
 * What a box for a child's account takes from typed or pasted text (rules.md,
 * 孩子): capitals become small letters, anything but the letters a–z and the
 * digits 0–9 is left out, as the family code's boxes do, and nothing past the
 * 20 characters an account may have is taken.
 */
export function childAccountText(text: string): string {
  return Array.from(text.toLowerCase())
    .filter((character) => /^[a-z0-9]$/.test(character))
    .slice(0, CHILD_ACCOUNT_MAX_LENGTH)
    .join('');
}
