import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { ChildrenService } from '../child/children.service.js';
import type { FamiliesService } from '../family/families.service.js';
import { FamilyDeletionService } from './family-deletion.service.js';

const PARENT_ID = '0b7c4e2a-1d3f-4a5b-9c6d-7e8f90a1b2c6';
const FAMILY_ID = '5d1e7f3a-9b2c-4d4e-a6f8-1a2b3c4d5e6f';

/**
 * The service with the family module answering the deletion with
 * `deletion`, and both collaborators writing each call into `calls`, in
 * the order they were made.
 */
function serviceWith(deletion: Promise<string[]>) {
  const calls: string[] = [];
  const families: Pick<FamiliesService, 'delete'> = {
    delete: (parentId, familyId) => {
      calls.push(`delete ${parentId} ${familyId}`);
      return deletion;
    },
  };
  const children: Pick<ChildrenService, 'removeLoginLinksOf'> = {
    removeLoginLinksOf: (childIds) => {
      calls.push(`links of ${childIds.join(' and ')}`);
      return Promise.resolve();
    },
  };
  const service = new FamilyDeletionService(
    families as FamiliesService,
    children as ChildrenService,
  );
  return { service, calls };
}

describe('FamilyDeletionService', () => {
  it('deletes the family, then the login links of the children deleted with it', async () => {
    const { service, calls } = serviceWith(Promise.resolve(['child-1', 'child-2']));

    await service.delete(PARENT_ID, FAMILY_ID);

    expect(calls).toEqual([`delete ${PARENT_ID} ${FAMILY_ID}`, 'links of child-1 and child-2']);
  });

  it('removes no link when the deletion is refused', async () => {
    const refusal = new ApiError('not_admin', HttpStatus.FORBIDDEN);
    const { service, calls } = serviceWith(Promise.reject(refusal));

    await expect(service.delete(PARENT_ID, FAMILY_ID)).rejects.toBe(refusal);

    expect(calls).toEqual([`delete ${PARENT_ID} ${FAMILY_ID}`]);
  });
});
