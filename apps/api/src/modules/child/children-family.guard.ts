import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { currentParentIdOf } from '../../infrastructure/authentication/current-parent.js';
import { FamiliesService } from '../family/families.service.js';
import { familyIdPipe } from './children-params.js';

/**
 * The membership check of the children routes under
 * `/api/families/{familyId}/children`: the family module's check, the same
 * every family route passes. It runs after the login check and before the
 * request is validated; a parent who is not a member, or a family that does
 * not exist, is 404 `family_not_found`. Every member may manage the
 * children, so the role is not asked for.
 */
@Injectable()
export class ChildrenFamilyGuard implements CanActivate {
  constructor(private readonly familiesService: FamiliesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const familyId = familyIdPipe.transform(request.params['familyId']);
    await this.familiesService.checkAccess(currentParentIdOf(request), familyId, 'member');
    return true;
  }
}
