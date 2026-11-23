import request from 'supertest';
import { TEST_APP_ORIGIN } from './containers.js';
import { outcomesOf, type Parent } from './families.js';
import { cookieHeader, testSessionTokens, type Target } from './login.js';

// Helpers for security tests that send every route of an area the same
// way: as a parent of another family, without a login, with a login of the
// wrong kind, or without this site's Origin.

/** One route: its method, its path and the body it is sent with. */
export interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  body?: object;
}

/** How a case prepares a request before it is sent. */
export type Prepare = (call: request.Test) => request.Test;

/** Sends each route in turn, prepared as the case needs, and answers the responses. */
export async function sendRoutes(
  target: Target,
  routes: Route[],
  prepare: Prepare,
): Promise<request.Response[]> {
  const responses: request.Response[] = [];
  for (const { method, path, body } of routes) {
    responses.push(await prepare(request(target)[method](path)).send(body));
  }
  return responses;
}

/** Prepares a request with this site's Origin and the cookies, as a browser sends it. */
export const withCookies =
  (cookies: Record<string, string>): Prepare =>
  (call) =>
    call.set('Origin', TEST_APP_ORIGIN).set('Cookie', cookieHeader(cookies));

/** Prepares a request as the parent's, with this site's Origin, as the web app sends it. */
export const fromParent = (parent: Parent): Prepare => withCookies(parent.cookies);

/** Prepares a request with this site's Origin and no login. */
export const signedOut: Prepare = (call) => call.set('Origin', TEST_APP_ORIGIN);

/**
 * Prepares a request with a valid login of the child in the cookie named,
 * the child's own or the parent's, to show that a login of the wrong kind
 * opens nothing in either.
 */
export async function withChildLoginIn(cookie: string, childId: string): Promise<Prepare> {
  return withCookies({ [cookie]: await testSessionTokens().issueSession('child', childId) });
}

/** The ways a change can come without this site's Origin, each with the parent's login. */
export const FOREIGN_ORIGINS: Array<[string, (parent: Parent) => Prepare]> = [
  ['without an Origin', (parent) => (call) => call.set('Cookie', cookieHeader(parent.cookies))],
  [
    'from another site',
    (parent) => (call) =>
      call.set('Origin', 'https://evil.example').set('Cookie', cookieHeader(parent.cookies)),
  ],
];

/** The routes that change data: every route but the reads. */
export const writes = (routes: Route[]) => routes.filter(({ method }) => method !== 'get');

/** The same answer for every response. */
export const each = (responses: request.Response[], outcome: [number, string]) =>
  responses.map(() => outcome);

/** Routes sent one way, the answer each must get, and what they must leave as it was. */
export interface Refusal {
  target: Target;
  routes: Route[];
  prepare: Prepare;
  outcome: [number, string];
  /** Reads what the routes could change. */
  state: () => Promise<unknown>;
}

/** Sends the routes and expects each refused with the outcome and nothing changed. */
export async function expectRefused({
  target,
  routes,
  prepare,
  outcome,
  state,
}: Refusal): Promise<void> {
  const before = await state();

  const responses = await sendRoutes(target, routes, prepare);

  expect(outcomesOf(responses)).toEqual(each(responses, outcome));
  expect(await state()).toEqual(before);
}

/**
 * Refusals of routes on the running application that must leave the state
 * read by `state` as it was: send the routes as prepared, and expect each
 * answered with the outcome. The application is read when a refusal is
 * sent, so this may be set up before the application starts.
 */
export function refusalsOn(running: { readonly server: Target }, state: () => Promise<unknown>) {
  return (routes: Route[], prepare: Prepare, outcome: [number, string]) =>
    expectRefused({ target: running.server, routes, prepare, outcome, state });
}
