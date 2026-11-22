import { FIXED_NOW } from '../../../testing/clock';
import {
  BrowserTimeZone,
  canonicalTimeZone,
  searchTimeZones,
  timeZoneOption,
  timeZoneOptions,
} from './time-zones';

const MINUS = '−';

describe('canonicalTimeZone', () => {
  it.each([
    ['Asia/Shanghai', 'Asia/Shanghai'],
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['Asia/Kolkata', 'Asia/Kolkata'],
    ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
  ])('gives %s as %s', (name, standard) => {
    expect(canonicalTimeZone(name)).toBe(standard);
  });

  it('knows no zone the browser does not know', () => {
    expect(canonicalTimeZone('Mars/Olympus_Mons')).toBeNull();
    expect(canonicalTimeZone('')).toBeNull();
  });
});

describe('timeZoneOption', () => {
  it('shows a zone east of UTC with its offset in full-width brackets', () => {
    expect(timeZoneOption('Asia/Shanghai', FIXED_NOW)).toEqual({
      id: 'Asia/Shanghai',
      offsetMinutes: 480,
      offset: 'UTC+08:00',
      label: 'Asia/Shanghai（UTC+08:00）',
    });
  });

  it('writes an offset west of UTC with a minus sign', () => {
    expect(timeZoneOption('America/Toronto', FIXED_NOW)?.offset).toBe(`UTC${MINUS}05:00`);
    expect(timeZoneOption('America/Toronto', FIXED_NOW)?.offsetMinutes).toBe(-300);
  });

  it('keeps the minutes of an offset that is not whole hours', () => {
    expect(timeZoneOption('Asia/Kathmandu', FIXED_NOW)?.offset).toBe('UTC+05:45');
  });

  it('gives UTC itself an offset of zero', () => {
    expect(timeZoneOption('UTC', FIXED_NOW)?.label).toBe('UTC（UTC+00:00）');
  });

  it('takes the offset at the moment given, summer time included', () => {
    const july = new Date('2026-07-01T12:00:00Z');

    expect(timeZoneOption('America/Toronto', july)?.offset).toBe(`UTC${MINUS}04:00`);
  });

  it('has nothing for a zone the browser does not know', () => {
    expect(timeZoneOption('Mars/Olympus_Mons', FIXED_NOW)).toBeNull();
  });
});

describe('timeZoneOptions', () => {
  const options = timeZoneOptions(FIXED_NOW, ['UTC']);
  const ids = options.map((option) => option.id);

  it('lists the zones by offset, and by name where offsets are equal', () => {
    for (let index = 1; index < options.length; index++) {
      const before = options[index - 1];
      const after = options[index];
      if (!before || !after) {
        continue;
      }
      expect(
        before.offsetMinutes < after.offsetMinutes ||
          (before.offsetMinutes === after.offsetMinutes &&
            before.id.localeCompare(after.id, 'en') < 0),
      ).toBe(true);
    }
    expect(options.length).toBeGreaterThan(300);
  });

  it('lists every zone once, by its standard name', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('Asia/Kolkata');
    expect(ids).not.toContain('Asia/Calcutta');
    expect(ids).toContain('Asia/Shanghai');
  });

  it('adds the zones asked for that the browser leaves out of its list', () => {
    expect(ids).toContain('UTC');
  });
});

describe('searchTimeZones', () => {
  const options = timeZoneOptions(FIXED_NOW);
  const idsFound = (query: string) => searchTimeZones(options, query).map((option) => option.id);

  it('finds the zones whose name contains the query, ignoring case', () => {
    const found = idsFound('TOR');

    expect(found.indexOf('America/Toronto')).toBeLessThan(found.indexOf('America/Tortola'));
    expect(found.indexOf('America/Toronto')).toBeGreaterThanOrEqual(0);
    expect(found.every((id) => id.toLowerCase().includes('tor'))).toBe(true);
  });

  it('finds a zone by a name with a hyphen in it, as typed', () => {
    expect(idsFound('port-au')).toEqual(['America/Port-au-Prince']);
    expect(idsFound('PORT-AU-PRINCE')).toEqual(['America/Port-au-Prince']);
  });

  it('finds the zones by offset, a typed hyphen standing for the minus sign', () => {
    const found = searchTimeZones(options, 'utc-05:00');

    expect(found.map((option) => option.id)).toContain('America/Toronto');
    expect(found.every((option) => option.offset === `UTC${MINUS}05:00`)).toBe(true);
  });

  it.each(['-05', `${MINUS}05`])('finds the zones by the offset alone, as in %s', (query) => {
    const found = searchTimeZones(options, query);

    expect(found.map((option) => option.id)).toContain('America/Toronto');
    expect(found.every((option) => option.offset.includes(`${MINUS}05`))).toBe(true);
  });

  it('finds them by the offset alone, as in +08', () => {
    expect(idsFound('+08')).toContain('Asia/Shanghai');
  });

  it('lists everything for an empty query', () => {
    expect(searchTimeZones(options, '  ')).toHaveLength(options.length);
  });
});

describe('BrowserTimeZone', () => {
  it("reports the browser's own zone by its standard name", () => {
    expect(new BrowserTimeZone().current()).toBe('UTC');
  });
});
