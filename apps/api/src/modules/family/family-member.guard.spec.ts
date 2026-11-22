import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { setCurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { FamiliesService } from './families.service.js';
import { FamilyAdmin, FamilyIdPipe, FamilyMemberGuard } from './family-member.guard.js';

const FAMILY_ID = '5d1e6f70-8192-4a3b-8c4d-5e6f708192a3';
const PARENT_ID = '0b7c2f4e-8d1a-4c3b-9e5f-6a7b8c9d0e1f';

/** Route handlers: one open to every member, one marked for the admin. */
const handlers = { open: () => undefined, adminOnly: () => undefined };
FamilyAdmin()(handlers, 'adminOnly', { value: handlers.adminOnly });

/** A controller with no mark, whose routes are marked one by one. */
class OpenController {
  readonly routes = handlers;
}

/** A controller marked for the admin as a whole. */
class AdminController {
  readonly routes = handlers;
}
FamilyAdmin()(AdminController);

/** A request to a family route with the given family id, by the signed-in parent. */
function contextFor(
  familyId: unknown,
  handler: keyof typeof handlers,
  controller: object = OpenController,
): ExecutionContext {
  const request = { params: { familyId } } as unknown as Request;
  setCurrentParentId(request, PARENT_ID);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handlers[handler],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function createGuard() {
  const familiesService = { checkAccess: vi.fn(() => Promise.resolve()) };
  const guard = new FamilyMemberGuard(
    new Reflector(),
    familiesService as unknown as FamiliesService,
  );
  return { guard, familiesService };
}

/** The error the pipe throws for the value. */
function pipeError(value: unknown): ApiError {
  try {
    new FamilyIdPipe().transform(value);
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('The value was accepted');
}

describe('FamilyMemberGuard', () => {
  it("checks the parent's membership of the family in the path", async () => {
    const { guard, familiesService } = createGuard();

    await expect(guard.canActivate(contextFor(FAMILY_ID, 'open'))).resolves.toBe(true);
    expect(familiesService.checkAccess).toHaveBeenCalledWith(PARENT_ID, FAMILY_ID, 'member');
  });

  it('needs the admin on a route marked for the admin', async () => {
    const { guard, familiesService } = createGuard();

    await guard.canActivate(contextFor(FAMILY_ID, 'adminOnly'));

    expect(familiesService.checkAccess).toHaveBeenCalledWith(PARENT_ID, FAMILY_ID, 'admin');
  });

  it('needs the admin on every route of a controller marked for the admin', async () => {
    const { guard, familiesService } = createGuard();

    await guard.canActivate(contextFor(FAMILY_ID, 'open', AdminController));

    expect(familiesService.checkAccess).toHaveBeenCalledWith(PARENT_ID, FAMILY_ID, 'admin');
  });

  it('answers a family id that is not an id as a family that does not exist', async () => {
    const { guard, familiesService } = createGuard();

    for (const familyId of ['not-an-id', '', `${FAMILY_ID}x`, undefined]) {
      await expect(guard.canActivate(contextFor(familyId, 'open'))).rejects.toMatchObject({
        code: 'family_not_found',
      });
    }
    expect(familiesService.checkAccess).not.toHaveBeenCalled();
  });

  it('passes on what the service refuses', async () => {
    const { guard, familiesService } = createGuard();
    familiesService.checkAccess.mockRejectedValue(new ApiError('not_admin', HttpStatus.FORBIDDEN));

    await expect(guard.canActivate(contextFor(FAMILY_ID, 'adminOnly'))).rejects.toMatchObject({
      code: 'not_admin',
    });
  });
});

describe('FamilyIdPipe', () => {
  it('passes on an id', () => {
    expect(new FamilyIdPipe().transform(FAMILY_ID)).toBe(FAMILY_ID);
  });

  it('answers anything else with 404 family_not_found', () => {
    const error = pipeError("1' or '1'='1");

    expect(error.code).toBe('family_not_found');
    expect(error.getStatus()).toBe(404);
  });
});
