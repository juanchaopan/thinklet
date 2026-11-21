import { FAMILY_CODE_ALPHABET, familyCodeSchema } from '@thinklet/contracts';
import { generateFamilyCode } from './family-code.js';

describe('generateFamilyCode', () => {
  it('makes six characters from the family code alphabet', () => {
    for (let draw = 0; draw < 1_000; draw += 1) {
      const code = generateFamilyCode();

      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
      expect(familyCodeSchema.parse(code)).toBe(code);
    }
  });

  it('never uses the characters that are easy to mix up', () => {
    const drawn = new Set(Array.from({ length: 1_000 }, () => generateFamilyCode()).join(''));

    for (const character of '01ILO') {
      expect(drawn.has(character), character).toBe(false);
    }
  });

  it('draws every position from the whole alphabet', () => {
    const bounds: number[] = [];
    let next = 0;

    const code = generateFamilyCode((max) => {
      bounds.push(max);
      next = (next + 5) % max;
      return next;
    });

    expect(bounds).toEqual([31, 31, 31, 31, 31, 31]);
    expect(code).toBe(
      [5, 10, 15, 20, 25, 30].map((index) => FAMILY_CODE_ALPHABET.charAt(index)).join(''),
    );
  });

  it('can reach the first and the last character of the alphabet', () => {
    expect(generateFamilyCode(() => 0)).toBe('222222');
    expect(generateFamilyCode((max) => max - 1)).toBe('ZZZZZZ');
  });

  it('gives different codes from draw to draw', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateFamilyCode()));

    expect(codes.size).toBeGreaterThan(95);
  });
});
