import {
  errorResponseSchema,
  familyDetailSchema,
  meResponseSchema,
  type FamilyDetail,
} from '@thinklet/contracts';
import request from 'supertest';
import { TEST_APP_ORIGIN } from './containers.js';
import { query } from './database.js';
import { cookieHeader, newUser, signIn, type Target } from './login.js';

// Helpers for tests of the family routes: parents signed in through the mock
// OIDC provider, requests sent as them, families set up for them and what
// the database holds about them.

/** A signed-in parent: their id and the cookies of their login. */
export interface Parent {
  id: string;
  cookies: Record<string, string>;
}

/** Signs in a new user of the mock provider with the claims and returns them as a parent. */
export async function signInParent(
  target: Target,
  claims?: Record<string, unknown>,
): Promise<Parent> {
  const { cookies } = await signIn(target, newUser(claims));
  const me = await request(target).get('/api/me').set('Cookie', cookieHeader(cookies));
  return { id: meResponseSchema.parse(me.body).id, cookies };
}

/** Requests as the parent, with this site's Origin as the web app sends them. */
export function as(target: Target, parent: Parent) {
  const signed = (call: request.Test) =>
    call.set('Origin', TEST_APP_ORIGIN).set('Cookie', cookieHeader(parent.cookies));
  return {
    get: (path: string) => signed(request(target).get(path)),
    post: (path: string, body?: object) => signed(request(target).post(path)).send(body),
    patch: (path: string, body: object) => signed(request(target).patch(path)).send(body),
    put: (path: string, body: object) => signed(request(target).put(path)).send(body),
    delete: (path: string) => signed(request(target).delete(path)),
  };
}

/** The status and error code of each error response. */
export function outcomesOf(responses: request.Response[]): Array<[number, string]> {
  return responses.map((response) => [
    response.status,
    errorResponseSchema.parse(response.body).error.code,
  ]);
}

/** Creates a family as the parent through the api and returns it. */
export async function createFamily(
  target: Target,
  parent: Parent,
  body: { name: string; timezone: string } = { name: '林悦的家', timezone: 'Asia/Shanghai' },
): Promise<FamilyDetail> {
  const response = await as(target, parent).post('/api/families', body);
  if (response.status !== 201) {
    throw new Error(`The family was not created: ${response.status}`);
  }
  return familyDetailSchema.parse(response.body);
}

/**
 * Makes the parent a member of the family directly in the database, as an
 * approved join request does.
 */
export async function addMember(
  databaseUrl: string,
  familyId: string,
  parentId: string,
): Promise<void> {
  await query(
    databaseUrl,
    "insert into family_members (family_id, parent_id, role) values ($1, $2, 'member')",
    [familyId, parentId],
  );
}

/** Records a pending join request of the parent directly in the database and returns its id. */
export async function addPendingRequest(
  databaseUrl: string,
  family: { id: string; code: string },
  parentId: string,
): Promise<string> {
  const [row] = await query<{ id: string }>(
    databaseUrl,
    `insert into join_requests (family_id, parent_id, code, status)
     values ($1, $2, $3, 'pending') returning id`,
    [family.id, parentId, family.code],
  );
  if (row === undefined) {
    throw new Error('No join request recorded');
  }
  return row.id;
}

/** A row of the family_members table. */
export interface MemberRow {
  parent_id: string;
  role: string;
}

/** The family's members as the database holds them, in joining order. */
export async function memberRows(databaseUrl: string, familyId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    databaseUrl,
    'select parent_id, role from family_members where family_id = $1 order by joined_at, parent_id',
    [familyId],
  );
}

/** A row of the families table. */
export interface FamilyRow {
  name: string;
  timezone: string;
  code: string;
  updated_at: Date;
}

export async function familyRow(databaseUrl: string, familyId: string): Promise<FamilyRow> {
  const [row] = await query<FamilyRow>(
    databaseUrl,
    'select name, timezone, code, updated_at from families where id = $1',
    [familyId],
  );
  if (row === undefined) {
    throw new Error(`No family ${familyId}`);
  }
  return row;
}
