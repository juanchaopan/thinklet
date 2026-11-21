import {
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { idSchema } from '@thinklet/contracts';
import type { Request } from 'express';
import { currentParentIdOf } from '../../infrastructure/authentication/current-parent.js';
import { FamiliesService, familyNotFound, type FamilyAccess } from './families.service.js';

/** The path parameter every route of one family is under: `/api/families/{familyId}/...`. */
export const FAMILY_ID_PARAM = 'familyId';

const FAMILY_ACCESS = 'thinklet:familyAccess';

/** Marks a route of a family that only the family's admin may use. */
export const FamilyAdmin = (): MethodDecorator => SetMetadata(FAMILY_ACCESS, 'admin');

/**
 * Reads the family id of the path. A value that is not an id names no
 * family, so it is answered as a family that does not exist rather than as
 * a malformed request.
 */
export class FamilyIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const result = idSchema.safeParse(value);
    if (!result.success) {
      throw familyNotFound();
    }
    return result.data;
  }
}

const familyIdPipe = new FamilyIdPipe();

/**
 * The membership check of every route under `/api/families/{familyId}`. It
 * runs after the login check and before the request is validated: a parent
 * who is not a member, or a family that does not exist, is 404
 * `family_not_found`; a route marked with `@FamilyAdmin()` needs the admin,
 * else 403 `not_admin`. The role is read from the database on every request.
 * The services check again inside their transactions, so a role that changes
 * between this check and the change itself is still refused.
 */
@Injectable()
export class FamilyMemberGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly familiesService: FamiliesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const familyId = familyIdPipe.transform(request.params[FAMILY_ID_PARAM]);
    const access =
      this.reflector.get<FamilyAccess | undefined>(FAMILY_ACCESS, context.getHandler()) ?? 'member';
    await this.familiesService.checkAccess(currentParentIdOf(request), familyId, access);
    return true;
  }
}
