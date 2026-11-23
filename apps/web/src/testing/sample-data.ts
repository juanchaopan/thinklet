import type {
  ApplicantJoinRequest,
  ErrorCode,
  FamilyCodeLookupResponse,
  FamilyDetail,
  FamilyJoinRequestsResponse,
  MeResponse,
} from '@thinklet/contracts';
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

/** 周秀英, the admin of the 外婆家 the join dialog finds: mint, as the design draws her. */
export const XIUYING_ID = '2f5a8c1e-7b3d-4e6f-9a0b-1c2d3e4f5a02';

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

/** 周子航 signed in: a member of 林悦的家 only. */
export const ZIHANG: MeResponse = {
  id: ZIHANG_ID,
  name: '周子航',
  email: null,
  families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }],
  requestResults: 0,
};

/** 林悦的家 as 周子航, a member who is not its admin, sees it. */
export const LINYUE_FAMILY_FOR_ZIHANG: FamilyDetail = {
  ...LINYUE_FAMILY,
  role: 'member',
  members: LINYUE_FAMILY.members.map((member) => ({
    ...member,
    you: member.parentId === ZIHANG_ID,
  })),
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

// 林悦's own requests to join families, one in each state, as the design
// draws them: sent on 21, 18, 15 and 6 November in the families' time zone.

export const PENDING_REQUEST: ApplicantJoinRequest = {
  id: '9c3a1b2d-4e5f-4a6b-8c7d-9e0f1a2b3c41',
  familyName: '舅舅家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '王建华',
  status: 'pending',
  createdAt: '2026-11-21T01:12:00Z',
};

export const APPROVED_REQUEST: ApplicantJoinRequest = {
  id: '77b0c1d2-e3f4-4a5b-9c6d-7e8f9a0b1c52',
  familyName: '外婆家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '周秀英',
  status: 'approved',
  createdAt: '2026-11-18T02:03:00Z',
};

export const REJECTED_REQUEST: ApplicantJoinRequest = {
  id: '3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a663',
  familyName: '周家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '周子航',
  status: 'rejected',
  createdAt: '2026-11-15T03:30:00Z',
};

export const EXPIRED_REQUEST: ApplicantJoinRequest = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c74',
  familyName: '姑姑家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '林美华',
  status: 'expired',
  createdAt: '2026-11-06T04:45:00Z',
};

/** The family the design's join dialog finds by its code. */
export const GRANDMA_LOOKUP: FamilyCodeLookupResponse = {
  familyName: '外婆家',
  adminName: '周秀英',
  adminId: XIUYING_ID,
};

// The requests to join 林悦的家 the design's new members page shows, whose
// applicants' ids give them the design's avatar colours: 陈晓 and 赵琳
// fuchsia, 王一凡 and 李想 sun, 林建国 mint. The times read as the design
// writes them in Shanghai.

export const CHENXIAO_ID = 'e8a1c3d5-7f9b-4a2c-8e4d-6f8a0b2c4d05';
export const YIFAN_ID = 'b4d6f8a0-2c4e-4a6b-9c8d-0e2f4a6b8c01';
export const LIXIANG_ID = 'c5e7a9b1-3d5f-4b7c-8d9e-1f3a5b7c9d02';
export const ZHAOLIN_ID = 'd6f8b0c2-4e6a-4c8d-9e0f-2a4b6c8d0e01';

/** 林悦的家's waiting requests and the handled ones 林悦 has not cleared. */
export const NEW_MEMBERS: FamilyJoinRequestsResponse = {
  pending: [
    {
      id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c01',
      parentId: CHENXIAO_ID,
      name: '陈晓',
      email: 'chenxiao@example.com',
      createdAt: '2026-11-21T01:12:00Z',
    },
    {
      id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c02',
      parentId: YIFAN_ID,
      name: '王一凡',
      email: 'yifan.wang@example.com',
      createdAt: '2026-11-20T12:40:00Z',
    },
  ],
  handled: [
    {
      id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c03',
      parentId: JIANGUO_ID,
      name: '林建国',
      email: 'jianguo.lin@example.com',
      status: 'approved',
      closedAt: '2026-11-18T02:03:00Z',
    },
    {
      id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c04',
      parentId: LIXIANG_ID,
      name: '李想',
      email: 'lixiang@example.com',
      status: 'rejected',
      closedAt: '2026-11-10T06:30:00Z',
    },
    {
      id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c05',
      parentId: ZHAOLIN_ID,
      name: '赵琳',
      email: 'zhaolin@example.com',
      status: 'expired',
      closedAt: '2026-11-06T08:15:00Z',
    },
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

/** Stubs `/api/child/me` as 401: no child is signed in on this browser. */
export function stubNoChild(): void {
  stubError('get /api/child/me', 401, 'unauthenticated');
}

/** Stubs `/api/me` and `/api/child/me` as 401: nobody is signed in, neither a parent nor a child. */
export function stubVisitor(): void {
  stubError('get /api/me', 401, 'unauthenticated');
  stubNoChild();
}

/** Stubs `GET /api/join-requests` with the parent's own requests. */
export function stubJoinRequests(requests: readonly ApplicantJoinRequest[] = []): void {
  worker.use(http.get('/api/join-requests', () => HttpResponse.json(requests)));
}

/**
 * Stubs the parent's world: `/api/me` with the parent,
 * `/api/families/{familyId}` with their families, and their own join
 * requests (none, unless a test stubs others after this).
 */
export function stubSignedIn(
  me: MeResponse = LINYUE,
  families: readonly FamilyDetail[] = [LINYUE_FAMILY, GRANDMA_FAMILY],
): void {
  stubJoinRequests();
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
