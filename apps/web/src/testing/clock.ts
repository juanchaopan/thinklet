/**
 * The moment every component test runs at: the day the design draws, so the
 * dates on screen read as they do in the design ("11月21日", no year). It is
 * midday in UTC, which is the same day in Asia/Shanghai, where the sample
 * families live. setup.ts fakes only `Date` with it, so dates shown in the
 * UI and in screenshots are the same on every run while Angular's own
 * timers stay real. A test that needs timers to move calls
 * `vi.useFakeTimers()` itself and advances them explicitly.
 */
export const FIXED_NOW = new Date('2026-11-21T12:00:00.000Z');

export function useFixedClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
}
