import { requestSlot } from './request-slot.js';

// The signed-in child travels on the request from the child's login check
// to the handlers of the child routes, the same way the signed-in parent
// does. The check records the child only once the child's JWT is verified
// and the child module has confirmed the child still exists and the login is
// newer than the last password reset.

const child = requestSlot<string>('The request has no signed-in child');

/** Records the signed-in child on the request. */
export const setCurrentChildId = child.set;

/**
 * The id of the signed-in child. Only requests that passed the child's login
 * check have one, so a child route that skipped the check fails instead of
 * answering for a child nobody confirmed.
 */
export const currentChildIdOf = child.of;

/** Handler parameter decorator for the signed-in child's id. */
export const CurrentChildId = child.param;
