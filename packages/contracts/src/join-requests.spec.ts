import { describe, expect, it } from 'vitest';
import {
  applicantJoinRequestListSchema,
  createJoinRequestRequestSchema,
  familyJoinRequestsResponseSchema,
  handledJoinRequestSchema,
  pendingJoinRequestSchema,
} from './join-requests.js';

const request = {
  id: '9c3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b',
  familyName: '外婆家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '周秀英',
  status: 'pending',
  createdAt: '2026-11-21T09:12:00Z',
};

const pending = {
  id: '9c3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b',
  parentId: 'e8a1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b',
  name: '陈晓',
  email: 'chenxiao@example.com',
  createdAt: '2026-11-21T09:12:00Z',
};

const handled = {
  id: '77b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d',
  parentId: 'c3d9e0f1-a2b3-4c4d-9e5f-6a7b8c9d0e1f',
  name: '林建国',
  email: null,
  status: 'approved',
  closedAt: '2026-11-18T10:03:00.000Z',
};

describe('createJoinRequestRequestSchema', () => {
  it('turns the code into capitals', () => {
    expect(createJoinRequestRequestSchema.parse({ code: '7kq4mz' })).toEqual({ code: '7KQ4MZ' });
  });

  it('rejects codes outside the alphabet', () => {
    expect(createJoinRequestRequestSchema.safeParse({ code: '0KQ4MZ' }).success).toBe(false);
  });
});

describe('applicantJoinRequestListSchema', () => {
  it('accepts pending, approved, rejected and expired requests with the family time zone', () => {
    const body = [
      request,
      { ...request, id: '88c0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d', status: 'approved' },
      { ...request, id: '77b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d', status: 'rejected' },
      { ...request, id: '66a0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d', status: 'expired' },
    ];

    expect(applicantJoinRequestListSchema.parse(body)).toEqual(body);
  });

  it('rejects withdrawn requests, which the applicant does not see', () => {
    expect(
      applicantJoinRequestListSchema.safeParse([{ ...request, status: 'withdrawn' }]).success,
    ).toBe(false);
  });

  it('rejects a time that is not an ISO date-time', () => {
    expect(
      applicantJoinRequestListSchema.safeParse([{ ...request, createdAt: '11月21日' }]).success,
    ).toBe(false);
  });
});

describe('familyJoinRequestsResponseSchema', () => {
  it("accepts pending and handled requests with each applicant's parent id", () => {
    const body = { pending: [pending], handled: [handled] };

    expect(familyJoinRequestsResponseSchema.parse(body)).toEqual(body);
  });

  it("requires the applicant's parent id as a uuid on both kinds", () => {
    expect(pendingJoinRequestSchema.safeParse({ ...pending, parentId: undefined }).success).toBe(
      false,
    );
    expect(handledJoinRequestSchema.safeParse({ ...handled, parentId: undefined }).success).toBe(
      false,
    );
    expect(pendingJoinRequestSchema.safeParse({ ...pending, parentId: '陈晓' }).success).toBe(
      false,
    );
  });

  it('rejects withdrawn and pending requests among the handled ones', () => {
    expect(handledJoinRequestSchema.safeParse({ ...handled, status: 'withdrawn' }).success).toBe(
      false,
    );
    expect(handledJoinRequestSchema.safeParse({ ...handled, status: 'pending' }).success).toBe(
      false,
    );
  });
});
