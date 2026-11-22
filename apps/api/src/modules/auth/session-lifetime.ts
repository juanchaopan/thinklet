// How long the login state and the login transaction last
// (`.docs/design/rules.md`, "登录和登录状态").

/** A login lasts 7 days from its last renewal. */
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/** A login with less than half its lifetime (3.5 days) left is renewed by the next request. */
export const RENEWAL_THRESHOLD_SECONDS = SESSION_LIFETIME_SECONDS / 2;

/** The state, nonce and PKCE verifier of a login under way last 10 minutes. */
export const LOGIN_TRANSACTION_LIFETIME_SECONDS = 10 * 60;

/** Whether a login that expires at the given time is renewed at `now`. */
export function needsRenewal(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() < RENEWAL_THRESHOLD_SECONDS * 1000;
}
