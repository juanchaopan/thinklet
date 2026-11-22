import { describe, expect, it } from 'vitest';
import {
  applicantJoinRequestListSchema,
  createJoinRequestRequestSchema,
  familyJoinRequestsResponseSchema,
  handledJoinRequestSchema,
} from './join-requests.js';

const request = {
  id: '9c3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b',
  familyName: '外婆家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '周秀英',
  status: 'pending',
  createdAt: '2026-11-21T09:12:00Z',
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
  it('accepts pending and handled requests', () => {
    const body = {
      pending: [
        {
          id: '9c3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b',
          name: '陈晓',
          email: 'chenxiao@example.com',
          createdAt: '2026-11-21T09:12:00Z',
        },
      ],
      handled: [
        {
          id: '77b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d',
          name: '林建国',
          email: null,
          status: 'approved',
          closedAt: '2026-11-18T10:03:00.000Z',
        },
      ],
    };

    expect(familyJoinRequestsResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects withdrawn and pending requests among the handled ones', () => {
    const handled = {
      id: '77b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d',
      name: '林建国',
      email: null,
      closedAt: '2026-11-18T10:03:00Z',
    };

    expect(handledJoinRequestSchema.safeParse({ ...handled, status: 'withdrawn' }).success).toBe(
      false,
    );
    expect(handledJoinRequestSchema.safeParse({ ...handled, status: 'pending' }).success).toBe(
      false,
    );
  });
});
