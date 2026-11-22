import { describe, expect, it } from 'vitest';
import {
  createFamilyRequestSchema,
  familyCodeLookupResponseSchema,
  familyDetailSchema,
  transferAdminRequestSchema,
  updateFamilyRequestSchema,
} from './families.js';

const adminId = '0b7c2f4e-8d1a-4c3b-9e5f-6a7b8c9d0e1f';
const memberId = '41f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';

describe('createFamilyRequestSchema', () => {
  it('trims the name and keeps the time zone', () => {
    expect(
      createFamilyRequestSchema.parse({ name: '  林悦的家 ', timezone: 'Asia/Shanghai' }),
    ).toEqual({ name: '林悦的家', timezone: 'Asia/Shanghai' });
  });

  it('requires both fields', () => {
    expect(createFamilyRequestSchema.safeParse({ name: '林悦的家' }).success).toBe(false);
    expect(createFamilyRequestSchema.safeParse({ timezone: 'Asia/Shanghai' }).success).toBe(false);
  });

  it('rejects other keys', () => {
    const body = { name: '林悦的家', timezone: 'Asia/Shanghai', code: '7KQ4MZ' };

    expect(createFamilyRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('updateFamilyRequestSchema', () => {
  it('accepts either field alone', () => {
    expect(updateFamilyRequestSchema.parse({ name: '外婆家 ' })).toEqual({ name: '外婆家' });
    expect(updateFamilyRequestSchema.parse({ timezone: 'Europe/London' })).toEqual({
      timezone: 'Europe/London',
    });
  });

  it('checks the fields it is given', () => {
    expect(updateFamilyRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateFamilyRequestSchema.safeParse({ timezone: 'Mars/Phobos' }).success).toBe(false);
  });
});

describe('transferAdminRequestSchema', () => {
  it('takes the new admin by parent id', () => {
    expect(transferAdminRequestSchema.parse({ parentId: memberId })).toEqual({
      parentId: memberId,
    });
    expect(transferAdminRequestSchema.safeParse({ parentId: 'someone' }).success).toBe(false);
  });
});

describe('familyDetailSchema', () => {
  const detail = {
    id: '5d1e6f70-8192-4a3b-8c4d-5e6f708192a3',
    name: '林悦的家',
    timezone: 'Asia/Shanghai',
    code: '7KQ4MZ',
    role: 'admin',
    members: [
      { parentId: adminId, name: '林悦', email: 'linyue@example.com', role: 'admin', you: true },
      { parentId: memberId, name: '周子航', email: null, role: 'member', you: false },
    ],
  };

  it('accepts a family with members whose email may be missing', () => {
    expect(familyDetailSchema.parse(detail)).toEqual(detail);
  });

  it('rejects an unknown role', () => {
    expect(familyDetailSchema.safeParse({ ...detail, role: 'owner' }).success).toBe(false);
  });
});

describe('familyCodeLookupResponseSchema', () => {
  const body = { familyName: '外婆家', adminName: '周秀英', adminId };

  it("carries the family name, the admin's name and the admin's parent id", () => {
    expect(familyCodeLookupResponseSchema.parse(body)).toEqual(body);
  });

  it('carries nothing else, such as the code', () => {
    expect(familyCodeLookupResponseSchema.safeParse({ ...body, code: '7KQ4MZ' }).success).toBe(
      false,
    );
  });

  it("requires the admin's parent id as a uuid", () => {
    const { familyName, adminName } = body;

    expect(familyCodeLookupResponseSchema.safeParse({ familyName, adminName }).success).toBe(false);
    expect(familyCodeLookupResponseSchema.safeParse({ ...body, adminId: '周秀英' }).success).toBe(
      false,
    );
  });
});
