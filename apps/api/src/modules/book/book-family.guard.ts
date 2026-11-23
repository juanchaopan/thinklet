import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { currentParentIdOf } from '../../infrastructure/authentication/current-parent.js';
import { FamiliesService } from '../family/families.service.js';
import { familyIdPipe } from './book-params.js';

/**
 * The membership check of the book routes under `/api/families/{familyId}`,
 * the family module's check that every family route passes. It runs after
 * the parent's login check and before the request is validated, so a
 * parent who is not a member, or a family that does not exist, is 404
 * `family_not_found` whatever the request holds. Every member may use the
 * library, so the role is not asked for.
 */
@Injectable()
export class BookFamilyGuard implements CanActivate {
  constructor(private readonly familiesService: FamiliesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const parentId = currentParentIdOf(request);
    await this.familiesService.checkAccess(
      parentId,
      familyIdPipe.transform(request.params['familyId']),
      'member',
    );
    return true;
  }
}
