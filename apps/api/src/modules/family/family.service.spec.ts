import type { FamilyRepository, MembershipRecord, ParentRecord } from './family.repository.js';
import {
  CONSENT_VERSION,
  emailOf,
  FALLBACK_PARENT_NAME,
  FamilyService,
  initialName,
} from './family.service.js';

const parent: ParentRecord = { id: 'parent-1', name: '林悦', email: 'linyue@example.com' };

interface Stored {
  /** Whether the parent exists. */
  exists?: boolean;
  memberships?: MembershipRecord[];
  requestResults?: number;
}

function createService({ exists = true, memberships = [], requestResults = 0 }: Stored = {}) {
  const repository = {
    upsertParentLogin: vi.fn(() => Promise.resolve('parent-1')),
    findParent: vi.fn(() => Promise.resolve(exists ? parent : undefined)),
    listMemberships: vi.fn(() => Promise.resolve(memberships)),
    countRequestResults: vi.fn(() => Promise.resolve(requestResults)),
    updateParentName: vi.fn(() => Promise.resolve(exists)),
  };
  return { service: new FamilyService(repository as unknown as FamilyRepository), repository };
}

describe('initialName', () => {
  it("takes the ID token's name", () => {
    expect(initialName({ name: '林悦', email: 'linyue@example.com' })).toBe('林悦');
  });

  it('trims the name', () => {
    expect(initialName({ name: '  林悦  ' })).toBe('林悦');
  });

  it('falls back to the part of the email before the @ without a name', () => {
    expect(initialName({ email: 'linyue@example.com' })).toBe('linyue');
    expect(initialName({ name: '   ', email: 'linyue@example.com' })).toBe('linyue');
    expect(initialName({ name: 42, email: 'linyue@example.com' })).toBe('linyue');
  });

  it('takes the part before the last @ of an email with a quoted @', () => {
    expect(initialName({ email: '"lin@yue"@example.com' })).toBe('"lin@yue"');
  });

  it('cuts a name to 20 characters, counting an emoji as one', () => {
    expect(initialName({ name: '一二三四五六七八九十一二三四五六七八九十多' })).toBe(
      '一二三四五六七八九十一二三四五六七八九十',
    );
    expect(initialName({ name: '👨‍👩‍👧'.repeat(21) })).toBe('👨‍👩‍👧'.repeat(20));
  });

  it('cuts the email part to 20 characters too', () => {
    expect(initialName({ email: `${'a'.repeat(25)}@example.com` })).toBe('a'.repeat(20));
  });

  it('leaves no space at the end of a cut name', () => {
    expect(initialName({ name: `${'a'.repeat(19)} b` })).toBe('a'.repeat(19));
  });

  it('uses 家长 with neither a name nor an email', () => {
    expect(FALLBACK_PARENT_NAME).toBe('家长');
    expect(initialName({})).toBe('家长');
    expect(initialName({ name: null, email: null })).toBe('家长');
  });

  it('uses 家长 when the name and the email are only spaces', () => {
    expect(initialName({ name: '   ' })).toBe('家长');
    expect(initialName({ name: '　 \t', email: '  ' })).toBe('家长');
  });

  it('uses 家长 when the email has nothing before the @', () => {
    expect(initialName({ email: '@example.com' })).toBe('家长');
    expect(initialName({ name: ' ', email: '  @example.com' })).toBe('家长');
  });
});

describe('emailOf', () => {
  it('keeps the email, without spaces around it', () => {
    expect(emailOf({ email: ' linyue@example.com ' })).toBe('linyue@example.com');
  });

  it('is null when the provider gave none', () => {
    expect(emailOf({})).toBeNull();
    expect(emailOf({ email: '' })).toBeNull();
    expect(emailOf({ email: '   ' })).toBeNull();
    expect(emailOf({ email: true })).toBeNull();
  });
});

describe('FamilyService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a login with the initial name, the email and the consent of now', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-21T09:12:00Z') });
    const { service, repository } = createService();

    await expect(
      service.recordLogin('https://idp.example.com', 'subject-1', {
        email: 'linyue@example.com',
      }),
    ).resolves.toBe('parent-1');

    expect(repository.upsertParentLogin).toHaveBeenCalledWith({
      issuer: 'https://idp.example.com',
      subject: 'subject-1',
      name: 'linyue',
      email: 'linyue@example.com',
      consentVersion: '2026-11-21',
      consentedAt: new Date('2026-11-21T09:12:00Z'),
    });
    expect(CONSENT_VERSION).toBe('2026-11-21');
  });

  it('records a login without an email with a null email', async () => {
    const { service, repository } = createService();

    await service.recordLogin('https://idp.example.com', 'subject-1', { name: '林悦' });

    expect(repository.upsertParentLogin).toHaveBeenCalledWith(
      expect.objectContaining({ name: '林悦', email: null }),
    );
  });

  it('records a login with only spaces for a name and no email as 家长', async () => {
    const { service, repository } = createService();

    await service.recordLogin('https://idp.example.com', 'subject-1', { name: '  ' });

    expect(repository.upsertParentLogin).toHaveBeenCalledWith(
      expect.objectContaining({ name: '家长', email: null }),
    );
  });

  it('returns the parent with their families, the pending requests only where they are admin', async () => {
    const { service } = createService({
      memberships: [
        { id: 'family-1', name: '林悦的家', role: 'admin', pendingRequests: 2 },
        { id: 'family-2', name: '外婆家', role: 'member', pendingRequests: 1 },
      ],
    });

    await expect(service.getMe('parent-1')).resolves.toEqual({
      ...parent,
      families: [
        { id: 'family-1', name: '林悦的家', role: 'admin', pendingRequests: 2 },
        { id: 'family-2', name: '外婆家', role: 'member' },
      ],
      requestResults: 0,
    });
  });

  it("counts the parent's request results not yet seen", async () => {
    const { service, repository } = createService({ requestResults: 3 });

    const me = await service.getMe('parent-1');

    expect(me.requestResults).toBe(3);
    expect(repository.countRequestResults).toHaveBeenCalledWith('parent-1');
  });

  it('keeps a zero count for an admin', async () => {
    const { service } = createService({
      memberships: [{ id: 'family-1', name: '林悦的家', role: 'admin', pendingRequests: 0 }],
    });

    const me = await service.getMe('parent-1');

    expect(me.families[0]).toEqual({
      id: 'family-1',
      name: '林悦的家',
      role: 'admin',
      pendingRequests: 0,
    });
  });

  it('treats a parent that no longer exists as not signed in', async () => {
    const { service } = createService({ exists: false });

    await expect(service.getMe('parent-1')).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    });
    await expect(service.updateName('parent-1', '林悦')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it("changes the parent's own name and returns them with their request results", async () => {
    const { service, repository } = createService({ requestResults: 1 });

    await expect(service.updateName('parent-1', '林悦')).resolves.toMatchObject({
      id: 'parent-1',
      requestResults: 1,
    });
    expect(repository.updateParentName).toHaveBeenCalledWith('parent-1', '林悦');
  });
});
