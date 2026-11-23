import { requestSlot } from './request-slot.js';

// The signed-in parent travels on the request from the login check, which
// records it once the parent's JWT is verified, to the handlers, which read
// it through the decorator. It lives in the infrastructure so every module
// can read it without reaching into the auth module.

const parent = requestSlot<string>('The request has no signed-in parent');

/** Records the signed-in parent on the request. */
export const setCurrentParentId = parent.set;

/**
 * The id of the signed-in parent. Only requests that passed the parent's
 * login check have one, so a route open without a login that reads it is a
 * programming error and fails.
 */
export const currentParentIdOf = parent.of;

/** Handler parameter decorator for the signed-in parent's id. */
export const CurrentParentId = parent.param;
