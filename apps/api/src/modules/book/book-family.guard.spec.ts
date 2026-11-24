import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { setCurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { FamiliesService } from '../family/families.service.js';
import { BookFamilyGuard } from './book-family.guard.js';

const FAMILY_ID = '5d1e6f70-8192-4a3b-8c4d-5e6f708192a3';
const PARENT_ID = '0b7c2f4e-8d1a-4c3b-9e5f-6a7b8c9d0e1f';

/** A book route of the family with the id, requested by the signed-in parent. */
function bookRouteOf(familyId: unknown): ExecutionContext {
  const request = { params: { familyId, bookId: 'carrot-counting' } } as unknown as Request;
  setCurrentParentId(request, PARENT_ID);
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('BookFamilyGuard', () => {
  const checkAccess = vi.fn((): Promise<void> => Promise.resolve());
  const guard = new BookFamilyGuard({ checkAccess } as unknown as FamiliesService);

  beforeEach(() => {
    checkAccess.mockClear();
  });

  it('lets any member of the family through', async () => {
    await expect(guard.canActivate(bookRouteOf(FAMILY_ID))).resolves.toBe(true);
    expect(checkAccess).toHaveBeenCalledWith(PARENT_ID, FAMILY_ID, 'member');
  });

  it('passes on the refusal of a parent who is not a member', async () => {
    const refusal = new ApiError('family_not_found', HttpStatus.NOT_FOUND);
    checkAccess.mockRejectedValueOnce(refusal);

    await expect(guard.canActivate(bookRouteOf(FAMILY_ID))).rejects.toBe(refusal);
  });

  it.each(['not-an-id', '', undefined])(
    'answers the family id %j as a family that does not exist, without a lookup',
    async (familyId) => {
      await expect(guard.canActivate(bookRouteOf(familyId))).rejects.toMatchObject({
        code: 'family_not_found',
      });
      expect(checkAccess).not.toHaveBeenCalled();
    },
  );
});
