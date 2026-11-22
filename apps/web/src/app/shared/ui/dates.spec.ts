import { formatDate } from './dates';

/** A moment in 2026, the year the tests run in (testing/clock.ts). */
const NOW = new Date('2026-11-21T12:00:00Z');

describe('formatDate', () => {
  it('writes a day of this year as month and day', () => {
    expect(formatDate('2026-11-18T02:03:00Z', 'Asia/Shanghai', { now: NOW })).toBe('11月18日');
    expect(formatDate('2026-03-06T02:03:00Z', 'Asia/Shanghai', { now: NOW })).toBe('3月6日');
  });

  it('adds the year for another year', () => {
    expect(formatDate('2025-11-18T02:03:00Z', 'Asia/Shanghai', { now: NOW })).toBe(
      '2025年11月18日',
    );
  });

  it('adds the time of day on the 24-hour clock', () => {
    expect(formatDate('2026-11-18T01:12:00Z', 'Asia/Shanghai', { now: NOW, withTime: true })).toBe(
      '11月18日 09:12',
    );
    expect(formatDate('2026-11-18T13:05:00Z', 'UTC', { now: NOW, withTime: true })).toBe(
      '11月18日 13:05',
    );
    expect(formatDate('2026-11-18T00:07:00Z', 'UTC', { now: NOW, withTime: true })).toBe(
      '11月18日 00:07',
    );
  });

  it('takes the day in the time zone given', () => {
    const lateEvening = '2026-11-17T20:00:00Z';

    expect(formatDate(lateEvening, 'Asia/Shanghai', { now: NOW })).toBe('11月18日');
    expect(formatDate(lateEvening, 'UTC', { now: NOW })).toBe('11月17日');
  });

  it('takes the year in the time zone given', () => {
    const newYearInShanghai = '2025-12-31T20:00:00Z';

    expect(formatDate(newYearInShanghai, 'Asia/Shanghai', { now: NOW })).toBe('1月1日');
    expect(formatDate(newYearInShanghai, 'UTC', { now: NOW })).toBe('2025年12月31日');
  });

  it('reads a time zone the browser does not know as UTC', () => {
    expect(formatDate('2026-11-17T20:00:00Z', 'Mars/Olympus_Mons', { now: NOW })).toBe('11月17日');
  });

  it('takes the present moment as now by default', () => {
    expect(formatDate(new Date(), 'UTC')).toBe('11月21日');
  });
});
