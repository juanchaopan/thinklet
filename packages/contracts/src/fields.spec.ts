import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  FAMILY_CODE_ALPHABET,
  characterCount,
  familyCodeSchema,
  familyNameSchema,
  idSchema,
  isTimeZone,
  parentNameSchema,
  timeZoneSchema,
  truncateCharacters,
} from './fields.js';

/** The parsed value, or the field error code the value is rejected with. */
function outcome(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? { value: result.data } : { error: result.error.issues[0]?.message };
}

describe('characterCount', () => {
  it('counts characters, not bytes or UTF-16 code units', () => {
    expect(characterCount('林悦的家')).toBe(4);
    expect(characterCount('😀')).toBe(1);
    expect(characterCount('👨‍👩‍👧')).toBe(1);
    expect(characterCount('é')).toBe(1);
    expect(characterCount('')).toBe(0);
  });
});

describe('truncateCharacters', () => {
  it('keeps the first characters without splitting an emoji', () => {
    expect(truncateCharacters('😀'.repeat(21), 20)).toBe('😀'.repeat(20));
    expect(truncateCharacters('林悦', 20)).toBe('林悦');
    expect(truncateCharacters('ab👨‍👩‍👧cd', 3)).toBe('ab👨‍👩‍👧');
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

  it('trims the name before counting', () => {
    expect(outcome(schema, '  林悦的家  ')).toEqual({ value: '林悦的家' });
    expect(outcome(schema, ` ${'a'.repeat(20)} `)).toEqual({ value: 'a'.repeat(20) });
  });

  it('counts an emoji as one character', () => {
    expect(outcome(schema, '😀'.repeat(20))).toEqual({ value: '😀'.repeat(20) });
    expect(outcome(schema, '😀'.repeat(21))).toEqual({ error: 'too_long' });
    expect(outcome(schema, '👨‍👩‍👧'.repeat(20))).toEqual({ value: '👨‍👩‍👧'.repeat(20) });
  });

  it('rejects a missing name as required and a non-string as invalid', () => {
    expect(outcome(schema, undefined)).toEqual({ error: 'required' });
    expect(outcome(schema, 5)).toEqual({ error: 'invalid' });
    expect(outcome(schema, null)).toEqual({ error: 'invalid' });
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

  it('rejects an unknown time zone as invalid', () => {
    expect(outcome(timeZoneSchema, 'Mars/Phobos')).toEqual({ error: 'invalid' });
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
