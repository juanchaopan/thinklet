import type { Executor } from '../../infrastructure/database/database.module.js';
import {
  AUDIT_TARGET_KINDS,
  AuditService,
  BY_SYSTEM,
  byChild,
  byParent,
  toAuditRow,
} from './audit.service.js';

const PARENT_ID = '0b7c5a1e-2f3d-4c5b-8a9e-1f2d3c4b5a69';
const CHILD_ID = '3f9b2c1d-4e5f-4a6b-9c8d-7e6f5a4b3c2d';
const FAMILY_ID = '5d1e7f2a-3b4c-4d5e-8f6a-9b0c1d2e3f4a';

describe('toAuditRow', () => {
  it('stores a parent as the actor by their id, the target kind of the action and its details', () => {
    expect(
      toAuditRow({
        actor: byParent(PARENT_ID),
        action: 'child.created',
        targetId: CHILD_ID,
        familyId: FAMILY_ID,
        details: { consentVersion: '2026-11-22' },
      }),
    ).toEqual({
      actorKind: 'parent',
      actorId: PARENT_ID,
      action: 'child.created',
      targetKind: 'child',
      targetId: CHILD_ID,
      familyId: FAMILY_ID,
      details: { consentVersion: '2026-11-22' },
    });
  });

  it('stores a child as the actor by their id', () => {
    expect(
      toAuditRow({
        actor: byChild(CHILD_ID),
        action: 'child.password_set',
        targetId: CHILD_ID,
        familyId: FAMILY_ID,
        details: { via: 'qr' },
      }),
    ).toMatchObject({ actorKind: 'child', actorId: CHILD_ID, targetKind: 'child' });
  });

  it('stores the site itself without an id', () => {
    expect(
      toAuditRow({
        actor: BY_SYSTEM,
        action: 'parent.deleted',
        targetId: PARENT_ID,
        familyId: null,
        details: { via: 'webhook' },
      }),
    ).toMatchObject({ actorKind: 'system', actorId: null, targetKind: 'parent', familyId: null });
  });

  it('stores an action without details with empty ones', () => {
    expect(
      toAuditRow({
        actor: byParent(PARENT_ID),
        action: 'parent.renamed',
        targetId: PARENT_ID,
        familyId: null,
      }),
    ).toMatchObject({ details: {} });
  });

  it('names a family member by the parent and a book by its id', () => {
    expect(AUDIT_TARGET_KINDS['member.removed']).toBe('member');
    expect(AUDIT_TARGET_KINDS['book.readers_changed']).toBe('book');
  });

  it('gives every action a target kind of the design', () => {
    const kinds = new Set(Object.values(AUDIT_TARGET_KINDS));
    expect([...kinds].sort()).toEqual([
      'book',
      'child',
      'family',
      'join_request',
      'member',
      'parent',
    ]);
  });
});

describe('AuditService', () => {
  it('writes the row with the transaction it is given', async () => {
    const repository = { insert: vi.fn(() => Promise.resolve()) };
    const service = new AuditService(repository);
    const transaction = { transaction: 'audit' } as unknown as Executor;

    await service.record(transaction, {
      actor: byParent(PARENT_ID),
      action: 'family.updated',
      targetId: FAMILY_ID,
      familyId: FAMILY_ID,
      details: { fields: ['name'] },
    });

    expect(repository.insert).toHaveBeenCalledWith(transaction, {
      actorKind: 'parent',
      actorId: PARENT_ID,
      action: 'family.updated',
      targetKind: 'family',
      targetId: FAMILY_ID,
      familyId: FAMILY_ID,
      details: { fields: ['name'] },
    });
  });
});
