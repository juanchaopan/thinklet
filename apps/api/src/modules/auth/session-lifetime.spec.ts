import {
  LOGIN_TRANSACTION_LIFETIME_SECONDS,
  needsRenewal,
  RENEWAL_THRESHOLD_SECONDS,
  SESSION_LIFETIME_SECONDS,
} from './session-lifetime.js';

const now = new Date('2026-11-21T09:00:00Z');
const inSeconds = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe('session lifetime', () => {
  it('lasts 7 days, renews below 3.5 days and gives a login 10 minutes', () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(604_800);
    expect(RENEWAL_THRESHOLD_SECONDS).toBe(302_400);
    expect(LOGIN_TRANSACTION_LIFETIME_SECONDS).toBe(600);
  });

  it('does not renew a fresh login', () => {
    expect(needsRenewal(inSeconds(SESSION_LIFETIME_SECONDS), now)).toBe(false);
  });

  it('does not renew a login with exactly 3.5 days left', () => {
    expect(needsRenewal(inSeconds(RENEWAL_THRESHOLD_SECONDS), now)).toBe(false);
  });

  it('renews a login with less than 3.5 days left', () => {
    expect(needsRenewal(inSeconds(RENEWAL_THRESHOLD_SECONDS - 1), now)).toBe(true);
    expect(needsRenewal(inSeconds(60), now)).toBe(true);
  });
});
