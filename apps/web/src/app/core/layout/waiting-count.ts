import type { MeFamily } from '@thinklet/contracts';

/** The most waiting requests a badge writes out; more read "99+" (rules.md, 通知). */
const MOST_COUNTED = 99;

/** What the switcher counts of a family: the requests waiting, carried only for its admin. */
type WaitingIn = Pick<MeFamily, 'pendingRequests'>;

/** A count as its red badge shows it: the number up to 99, then "99+". */
export function countText(count: number): string {
  return count > MOST_COUNTED ? `${String(MOST_COUNTED)}+` : String(count);
}

/**
 * What screen readers hear for a red count of waiting join requests, after
 * the name of what it sits on: the badge itself is only a mark.
 */
export function waitingText(count: number): string {
  return `，${countText(count)} 个申请等你处理`;
}

/**
 * The join requests waiting in the families the parent runs, which the
 * family switcher counts (rules.md, 通知): a family carries its count only
 * for its admin.
 */
export function waitingInAll(families: readonly WaitingIn[]): number {
  return families.reduce((sum, family) => sum + (family.pendingRequests ?? 0), 0);
}
