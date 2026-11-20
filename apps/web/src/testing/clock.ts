/**
 * The moment every component test runs at. setup.ts fakes only `Date` with
 * it, so dates shown in the UI and in screenshots are the same on every run
 * while Angular's own timers stay real. A test that needs timers to move
 * calls `vi.useFakeTimers()` itself and advances them explicitly.
 */
export const FIXED_NOW = new Date('2026-01-05T09:00:00.000Z');

export function useFixedClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW });
}
