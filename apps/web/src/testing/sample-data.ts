import type { ErrorCode, FamilyDetail, MeResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { worker } from './network';

// The people and families the design draws (林悦, admin of 林悦的家 and a
// member of 外婆家; 周子航 and 林建国 in her family), as the api returns them.
// The parents' ids give them the avatar colours of the design: 林悦 violet,
// 周子航 sky, 林建国 mint.

export const LINYUE_ID = '0b7c4e2a-1d3f-4a5b-9c6d-7e8f90a1b2c6';
export const ZIHANG_ID = '41f2a8c6-5b7d-4e9f-8a1b-2c3d4e5f6a71';
export const JIANGUO_ID = '6c1d9e3f-2a4b-4c5d-8e6f-7a8b9c0d1e22';
export const LINYUE_FAMILY_ID = '5d1e7f3a-9b2c-4d4e-a6f8-1a2b3c4d5e6f';
export const GRANDMA_FAMILY_ID = '8a40c2e4-6f1b-4a3c-9d5e-7f8a9b0c1d2e';

/**
 * 林悦 signed in: admin of 林悦的家 with two requests waiting, member of
 * 外婆家, with no request results to see.
 */
export const LINYUE: MeResponse = {
  id: LINYUE_ID,
  name: '林悦',
  email: 'linyue@example.com',
  families: [
    { id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'admin', pendingRequests: 2 },
    { id: GRANDMA_FAMILY_ID, name: '外婆家', role: 'member' },
  ],
  requestResults: 0,
};

/** 林悦 with a request result she has not seen yet: the red dots are on. */
export const LINYUE_WITH_RESULTS: MeResponse = { ...LINYUE, requestResults: 1 };

/** 林悦 before she has a family. */
export const LINYUE_WITHOUT_FAMILY: MeResponse = { ...LINYUE, families: [] };

/** 林悦的家 as its members see it. */
export const LINYUE_FAMILY: FamilyDetail = {
  id: LINYUE_FAMILY_ID,
  name: '林悦的家',
  timezone: 'Asia/Shanghai',
  code: '7KQ4MZ',
  role: 'admin',
  members: [
    { parentId: LINYUE_ID, name: '林悦', email: 'linyue@example.com', role: 'admin', you: true },
    { parentId: ZIHANG_ID, name: '周子航', email: null, role: 'member', you: false },
    {
      parentId: JIANGUO_ID,
      name: '林建国',
      email: 'jianguo.lin@example.com',
      role: 'member',
      you: false,
    },
  ],
};

/** 外婆家, where 林悦 is a member. */
export const GRANDMA_FAMILY: FamilyDetail = {
  id: GRANDMA_FAMILY_ID,
  name: '外婆家',
  timezone: 'Asia/Shanghai',
  code: 'H8P2RW',
  role: 'member',
  members: [
    {
      parentId: JIANGUO_ID,
      name: '林建国',
      email: 'jianguo.lin@example.com',
      role: 'admin',
      you: false,
    },
    { parentId: LINYUE_ID, name: '林悦', email: 'linyue@example.com', role: 'member', you: true },
  ],
};

/** The request id the stubbed failures carry. */
export const REQUEST_ID = 'a1f392c0-5b7d-4e9f-8a1b-2c3d4e5f6a7b';

/** The error number the screen shows for REQUEST_ID: its first 8 characters. */
export const ERROR_NUMBER = 'a1f3-92c0';

/** The body of an api error response. */
export function errorBody(code: ErrorCode, extra: Record<string, unknown> = {}) {
  return { error: { code, requestId: REQUEST_ID, ...extra } };
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** Stubs a call to fail with the given status and error code (plus `fields` and the like). */
export function stubError(
  call: `${Method} ${string}`,
  status: number,
  code: ErrorCode,
  extra: Record<string, unknown> = {},
): void {
  const [method, path] = call.split(' ') as [Method, string];
  worker.use(http[method](path, () => HttpResponse.json(errorBody(code, extra), { status })));
}

/** Stubs `/api/me` as 401: nobody is signed in. */
export function stubVisitor(): void {
  stubError('get /api/me', 401, 'unauthenticated');
}

/** Stubs `/api/me` with the parent and `/api/families/{familyId}` with their families. */
export function stubSignedIn(
  me: MeResponse = LINYUE,
  families: readonly FamilyDetail[] = [LINYUE_FAMILY, GRANDMA_FAMILY],
): void {
  worker.use(
    http.get('/api/me', () => HttpResponse.json(me)),
    http.get('/api/families/:familyId', ({ params }) => {
      const family = families.find((candidate) => candidate.id === params['familyId']);
      return family
        ? HttpResponse.json(family)
        : HttpResponse.json(errorBody('family_not_found'), { status: 404 });
    }),
  );
}
