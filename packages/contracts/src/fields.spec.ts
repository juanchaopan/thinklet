import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  FAMILY_CODE_ALPHABET,
  booleanFieldSchema,
  canonicalTimeZone,
  characterCount,
  childAccountSchema,
  childNicknameSchema,
  childPasswordSchema,
  familyCodeSchema,
  familyNameSchema,
  idSchema,
  isTimeZone,
  newChildPasswordSchema,
  parentNameSchema,
  timeZoneSchema,
  truncateCharacters,
  utf8Length,
  withinChildPasswordLimits,
} from './fields.js';

/** The parsed value, or the field error code the value is rejected with. */
function outcome(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? { value: result.data } : { error: result.error.issues[0]?.message };
}

/** Every field error code the value is rejected with; empty when it is accepted. */
function errorCodes(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

/** A combining accent: two bytes of UTF-8 that add no character. */
const ACUTE = String.fromCodePoint(0x301);

/** A family of three: one character of 18 bytes, joined from three emoji. */
const FAMILY = '👨‍👩‍👧';

/**
 * Text of the given number of UTF-8 bytes in two characters: a letter
 * carrying a run of accents, then one more letter (or two, when the byte
 * count is odd).
 */
function twoCharactersOf(bytes: number): string {
  const accents = Math.floor((bytes - 2) / 2);
  const text = `a${ACUTE.repeat(accents)}b${bytes % 2 === 1 ? 'c' : ''}`;
  if (utf8Length(text) !== bytes) {
    throw new Error(`Made ${String(utf8Length(text))} bytes instead of ${String(bytes)}`);
  }
  return text;
}

describe('characterCount', () => {
  it('counts characters, not bytes or UTF-16 code units', () => {
    expect(characterCount('林悦的家')).toBe(4);
    expect(characterCount('😀')).toBe(1);
    expect(characterCount(FAMILY)).toBe(1);
    expect(characterCount('é')).toBe(1);
    expect(characterCount(`a${ACUTE.repeat(100)}`)).toBe(1);
    expect(characterCount('')).toBe(0);
  });
});

describe('utf8Length', () => {
  it('counts the bytes of UTF-8', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('林悦')).toBe(6);
    expect(utf8Length('😀')).toBe(4);
    expect(utf8Length(FAMILY)).toBe(18);
    expect(utf8Length(`a${ACUTE}`)).toBe(3);
    expect(utf8Length('')).toBe(0);
  });
});

describe('truncateCharacters', () => {
  it('keeps the first characters without splitting an emoji', () => {
    expect(truncateCharacters('😀'.repeat(21), 20)).toBe('😀'.repeat(20));
    expect(truncateCharacters('林悦', 20)).toBe('林悦');
    expect(truncateCharacters(`ab${FAMILY}cd`, 3)).toBe(`ab${FAMILY}`);
  });

  it('stops before the character that would pass the bytes allowed', () => {
    expect(truncateCharacters('林悦的家', 20, 9)).toBe('林悦的');
    expect(truncateCharacters('林悦的家', 20, 8)).toBe('林悦');
    expect(truncateCharacters(`林${ACUTE.repeat(200)}悦`, 20, 320)).toBe('');
    expect(truncateCharacters(`林悦${ACUTE.repeat(200)}`, 20, 320)).toBe('林');
  });

  it('keeps whichever limit is reached first', () => {
    expect(truncateCharacters('a'.repeat(400), 20, 320)).toBe('a'.repeat(20));
    expect(truncateCharacters('家'.repeat(30), 20, 30)).toBe('家'.repeat(10));
  });
});

describe.each([
  ['familyNameSchema', familyNameSchema],
  ['parentNameSchema', parentNameSchema],
])('%s', (_name, schema) => {
  it('rejects an empty name as required', () => {
    expect(outcome(schema, '')).toEqual({ error: 'required' });
  });

  it('rejects a name of only whitespace as required', () => {
    expect(outcome(schema, ' \t\n　 ')).toEqual({ error: 'required' });
  });

  it('accepts 1 and 20 characters', () => {
    expect(outcome(schema, '家')).toEqual({ value: '家' });
    expect(outcome(schema, '家'.repeat(20))).toEqual({ value: '家'.repeat(20) });
  });

  it('rejects 21 characters as too long', () => {
    expect(outcome(schema, '家'.repeat(21))).toEqual({ error: 'too_long' });
  });

  it('accepts 320 bytes and rejects 321 as too long, however few the characters', () => {
    expect(outcome(schema, twoCharactersOf(320))).toEqual({ value: twoCharactersOf(320) });
    expect(errorCodes(schema, twoCharactersOf(321))).toEqual(['too_long']);
  });

  it('counts the bytes once the name is trimmed', () => {
    expect(outcome(schema, `  ${twoCharactersOf(320)}  `)).toEqual({
      value: twoCharactersOf(320),
    });
  });

  it('reports a name too long in both ways once', () => {
    expect(errorCodes(schema, '家'.repeat(200))).toEqual(['too_long']);
  });

  it('trims the name before counting', () => {
    expect(outcome(schema, '  林悦的家  ')).toEqual({ value: '林悦的家' });
    expect(outcome(schema, ` ${'a'.repeat(20)} `)).toEqual({ value: 'a'.repeat(20) });
  });

  it('counts an emoji as one character', () => {
    expect(outcome(schema, '😀'.repeat(20))).toEqual({ value: '😀'.repeat(20) });
    expect(outcome(schema, '😀'.repeat(21))).toEqual({ error: 'too_long' });
    expect(outcome(schema, FAMILY.repeat(17))).toEqual({ value: FAMILY.repeat(17) });
  });

  it('rejects joined emoji past 320 bytes as too long, before 20 characters', () => {
    expect(errorCodes(schema, FAMILY.repeat(18))).toEqual(['too_long']);
  });

  it('rejects a missing name as required and a non-string as invalid', () => {
    expect(outcome(schema, undefined)).toEqual({ error: 'required' });
    expect(outcome(schema, 5)).toEqual({ error: 'invalid' });
    expect(outcome(schema, null)).toEqual({ error: 'invalid' });
  });
});

describe('childNicknameSchema', () => {
  it('accepts 1 and 10 characters of any kind', () => {
    expect(outcome(childNicknameSchema, '米')).toEqual({ value: '米' });
    expect(outcome(childNicknameSchema, '米'.repeat(10))).toEqual({ value: '米'.repeat(10) });
    expect(outcome(childNicknameSchema, 'Mi 小米 ✨')).toEqual({ value: 'Mi 小米 ✨' });
  });

  it('rejects 11 characters as too long', () => {
    expect(outcome(childNicknameSchema, '米'.repeat(11))).toEqual({ error: 'too_long' });
  });

  it('accepts 160 bytes and rejects 161 as too long, however few the characters', () => {
    expect(outcome(childNicknameSchema, twoCharactersOf(160))).toEqual({
      value: twoCharactersOf(160),
    });
    expect(errorCodes(childNicknameSchema, twoCharactersOf(161))).toEqual(['too_long']);
  });

  it('counts an emoji as one character', () => {
    expect(outcome(childNicknameSchema, '😀'.repeat(10))).toEqual({ value: '😀'.repeat(10) });
    expect(outcome(childNicknameSchema, '😀'.repeat(11))).toEqual({ error: 'too_long' });
    expect(outcome(childNicknameSchema, FAMILY.repeat(8))).toEqual({ value: FAMILY.repeat(8) });
    expect(outcome(childNicknameSchema, FAMILY.repeat(11))).toEqual({ error: 'too_long' });
  });

  it('rejects joined emoji past 160 bytes as too long, before 10 characters', () => {
    expect(errorCodes(childNicknameSchema, FAMILY.repeat(9))).toEqual(['too_long']);
  });

  it('trims the nickname before counting', () => {
    expect(outcome(childNicknameSchema, `  ${'米'.repeat(10)}  `)).toEqual({
      value: '米'.repeat(10),
    });
  });

  it('rejects an empty, blank or missing nickname as required and a non-string as invalid', () => {
    expect(outcome(childNicknameSchema, '')).toEqual({ error: 'required' });
    expect(outcome(childNicknameSchema, ' \t　 ')).toEqual({ error: 'required' });
    expect(outcome(childNicknameSchema, undefined)).toEqual({ error: 'required' });
    expect(outcome(childNicknameSchema, 7)).toEqual({ error: 'invalid' });
  });
});

describe('childAccountSchema', () => {
  it('accepts 1 and 20 lower-case letters and digits', () => {
    expect(outcome(childAccountSchema, 'x')).toEqual({ value: 'x' });
    expect(outcome(childAccountSchema, 'xiaomi2016')).toEqual({ value: 'xiaomi2016' });
    expect(outcome(childAccountSchema, 'a'.repeat(20))).toEqual({ value: 'a'.repeat(20) });
    expect(outcome(childAccountSchema, '0123456789')).toEqual({ value: '0123456789' });
  });

  it('rejects 21 characters as too long', () => {
    expect(errorCodes(childAccountSchema, 'a'.repeat(21))).toEqual(['too_long']);
  });

  it('trims the account before checking it', () => {
    expect(outcome(childAccountSchema, `  ${'a'.repeat(20)} `)).toEqual({ value: 'a'.repeat(20) });
  });

  it('rejects capitals as invalid instead of lowering them', () => {
    for (const value of ['Xiaomi', 'XIAOMI', 'xiaoMi']) {
      expect(errorCodes(childAccountSchema, value), value).toEqual(['invalid']);
    }
  });

  it('rejects any other character as invalid, whatever the length', () => {
    for (const value of [
      'xiao mi',
      'xiao_mi',
      'xiao-mi',
      'xiaomi!',
      '小米',
      'xiaomí',
      '😀',
      'ａ',
    ]) {
      expect(errorCodes(childAccountSchema, value), value).toEqual(['invalid']);
    }
    expect(errorCodes(childAccountSchema, `${'a'.repeat(21)}A`)).toEqual(['invalid']);
  });

  it('rejects an empty, blank or missing account as required and a non-string as invalid', () => {
    expect(errorCodes(childAccountSchema, '')).toEqual(['required']);
    expect(errorCodes(childAccountSchema, '   ')).toEqual(['required']);
    expect(errorCodes(childAccountSchema, undefined)).toEqual(['required']);
    expect(errorCodes(childAccountSchema, 12)).toEqual(['invalid']);
  });
});

describe('withinChildPasswordLimits', () => {
  it('allows 32 characters and 128 bytes', () => {
    expect(withinChildPasswordLimits('a'.repeat(32))).toBe(true);
    expect(withinChildPasswordLimits('😀'.repeat(32))).toBe(true);
    expect(withinChildPasswordLimits('')).toBe(true);
  });

  it('refuses 33 characters', () => {
    expect(withinChildPasswordLimits('a'.repeat(33))).toBe(false);
  });

  it('refuses 129 bytes, however few the characters', () => {
    expect(withinChildPasswordLimits(twoCharactersOf(128))).toBe(true);
    expect(withinChildPasswordLimits(twoCharactersOf(129))).toBe(false);
    expect(withinChildPasswordLimits(FAMILY.repeat(8))).toBe(false);
    expect(withinChildPasswordLimits('a'.repeat(100_000))).toBe(false);
  });
});

describe('newChildPasswordSchema', () => {
  it('rejects 5 characters as too short and accepts 6', () => {
    expect(errorCodes(newChildPasswordSchema, 'abcde')).toEqual(['too_short']);
    expect(outcome(newChildPasswordSchema, 'abcdef')).toEqual({ value: 'abcdef' });
  });

  it('accepts 32 characters and rejects 33 as too long', () => {
    expect(outcome(newChildPasswordSchema, 'a'.repeat(32))).toEqual({ value: 'a'.repeat(32) });
    expect(errorCodes(newChildPasswordSchema, 'a'.repeat(33))).toEqual(['too_long']);
  });

  it('accepts 128 bytes and rejects 129 as too long', () => {
    expect(outcome(newChildPasswordSchema, '😀'.repeat(32))).toEqual({ value: '😀'.repeat(32) });
    const heavy = `abcde${twoCharactersOf(124)}`;
    expect(utf8Length(heavy)).toBe(129);
    expect(errorCodes(newChildPasswordSchema, heavy)).toEqual(['too_long']);
  });

  it('counts characters as a reader does', () => {
    expect(errorCodes(newChildPasswordSchema, '😀'.repeat(5))).toEqual(['too_short']);
    expect(outcome(newChildPasswordSchema, '😀'.repeat(6))).toEqual({ value: '😀'.repeat(6) });
    expect(outcome(newChildPasswordSchema, '密'.repeat(32))).toEqual({ value: '密'.repeat(32) });
    expect(outcome(newChildPasswordSchema, FAMILY.repeat(6))).toEqual({ value: FAMILY.repeat(6) });
  });

  it('keeps spaces, at the ends too, and counts them', () => {
    expect(outcome(newChildPasswordSchema, ' a b c ')).toEqual({ value: ' a b c ' });
    expect(errorCodes(newChildPasswordSchema, '  ab ')).toEqual(['too_short']);
  });

  it('rejects an empty or missing password as required and a non-string as invalid', () => {
    expect(errorCodes(newChildPasswordSchema, '')).toEqual(['required']);
    expect(errorCodes(newChildPasswordSchema, undefined)).toEqual(['required']);
    expect(errorCodes(newChildPasswordSchema, 123456)).toEqual(['invalid']);
  });
});

describe('childPasswordSchema', () => {
  it('accepts a password of any length, as it is', () => {
    for (const value of ['a', 'abcde', ' abc ', 'a'.repeat(33), twoCharactersOf(129)]) {
      expect(outcome(childPasswordSchema, value), value).toEqual({ value });
    }
  });

  it('rejects an empty or missing password as required', () => {
    expect(errorCodes(childPasswordSchema, '')).toEqual(['required']);
    expect(errorCodes(childPasswordSchema, undefined)).toEqual(['required']);
    expect(errorCodes(childPasswordSchema, null)).toEqual(['invalid']);
  });
});

describe('booleanFieldSchema', () => {
  it('accepts true and false only', () => {
    expect(outcome(booleanFieldSchema, true)).toEqual({ value: true });
    expect(outcome(booleanFieldSchema, false)).toEqual({ value: false });
    expect(outcome(booleanFieldSchema, 'true')).toEqual({ error: 'invalid' });
    expect(outcome(booleanFieldSchema, undefined)).toEqual({ error: 'required' });
  });
});

describe('familyCodeSchema', () => {
  it('accepts six characters from the alphabet', () => {
    expect(outcome(familyCodeSchema, '7KQ4MZ')).toEqual({ value: '7KQ4MZ' });
  });

  it('accepts every character of the alphabet', () => {
    for (const character of FAMILY_CODE_ALPHABET) {
      expect(familyCodeSchema.safeParse(character.repeat(6)).success, character).toBe(true);
    }
  });

  it('leaves out the characters that are easy to mix up', () => {
    expect(FAMILY_CODE_ALPHABET).toBe('23456789ABCDEFGHJKMNPQRSTUVWXYZ');
    for (const character of ['0', 'O', '1', 'I', 'L', 'o', 'i', 'l']) {
      expect(outcome(familyCodeSchema, `${character}KQ4MZ`), character).toEqual({
        error: 'invalid',
      });
    }
  });

  it('turns lower case into capitals', () => {
    expect(outcome(familyCodeSchema, '7kq4mz')).toEqual({ value: '7KQ4MZ' });
    expect(outcome(familyCodeSchema, '7kQ4mZ')).toEqual({ value: '7KQ4MZ' });
  });

  it('rejects codes of another length or with other characters', () => {
    for (const value of ['7KQ4M', '7KQ4MZA', '', '7KQ-MZ', ' 7KQ4MZ', '7KQ4M😀']) {
      expect(outcome(familyCodeSchema, value), value).toEqual({ error: 'invalid' });
    }
  });

  it('rejects a missing code as required', () => {
    expect(outcome(familyCodeSchema, undefined)).toEqual({ error: 'required' });
  });
});

describe('canonicalTimeZone', () => {
  it.each([
    ['Asia/Shanghai', 'Asia/Shanghai'],
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['Asia/Kolkata', 'Asia/Kolkata'],
    ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
    ['US/Pacific', 'America/Los_Angeles'],
    ['Etc/UTC', 'UTC'],
  ])('gives %s as %s', (name, standard) => {
    expect(canonicalTimeZone(name)).toBe(standard);
  });

  it('gives every time zone Intl lists as a name it keeps as it is', () => {
    for (const name of Intl.supportedValuesOf('timeZone')) {
      const standard = canonicalTimeZone(name) ?? '';
      expect(canonicalTimeZone(standard), name).toBe(standard);
    }
  });

  it('knows no zone Intl does not know', () => {
    expect(canonicalTimeZone('Mars/Olympus_Mons')).toBeNull();
    expect(canonicalTimeZone('')).toBeNull();
  });
});

describe('isTimeZone', () => {
  it('accepts IANA time zone names', () => {
    for (const name of [
      'Asia/Shanghai',
      'Europe/London',
      'America/Argentina/Buenos_Aires',
      'America/Port-au-Prince',
      'Etc/GMT+8',
      'UTC',
    ]) {
      expect(isTimeZone(name), name).toBe(true);
    }
  });

  it('accepts every time zone Intl lists', () => {
    for (const name of Intl.supportedValuesOf('timeZone')) {
      expect(isTimeZone(name), name).toBe(true);
    }
  });

  it('rejects names Intl does not know, offsets and other spellings', () => {
    for (const value of [
      '',
      'Mars/Phobos',
      'Asia',
      '+08:00',
      'UTC+8',
      'asia/shanghai',
      'ASIA/SHANGHAI',
      ' Asia/Shanghai',
      'Asia/Shanghai/',
      'Asia//Shanghai',
    ]) {
      expect(isTimeZone(value), value).toBe(false);
    }
  });
});

describe('timeZoneSchema', () => {
  it('accepts a time zone name', () => {
    expect(outcome(timeZoneSchema, 'Asia/Shanghai')).toEqual({ value: 'Asia/Shanghai' });
  });

  it.each([
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['US/Pacific', 'America/Los_Angeles'],
    ['Etc/UTC', 'UTC'],
  ])('gives the alias %s as the standard name %s', (alias, standard) => {
    expect(outcome(timeZoneSchema, alias)).toEqual({ value: standard });
  });

  it('rejects an unknown time zone as invalid', () => {
    expect(outcome(timeZoneSchema, 'Mars/Phobos')).toEqual({ error: 'invalid' });
    expect(outcome(timeZoneSchema, 'asia/shanghai')).toEqual({ error: 'invalid' });
    expect(outcome(timeZoneSchema, 8)).toEqual({ error: 'invalid' });
  });

  it('rejects an empty or missing time zone as required', () => {
    expect(outcome(timeZoneSchema, '')).toEqual({ error: 'required' });
    expect(outcome(timeZoneSchema, undefined)).toEqual({ error: 'required' });
  });
});

describe('idSchema', () => {
  it('accepts a UUID and rejects anything else', () => {
    const id = '0b7c2f4e-8d1a-4c3b-9e5f-6a7b8c9d0e1f';

    expect(outcome(idSchema, id)).toEqual({ value: id });
    expect(outcome(idSchema, 'not-a-uuid')).toEqual({ error: 'invalid' });
    expect(outcome(idSchema, undefined)).toEqual({ error: 'required' });
  });
});
