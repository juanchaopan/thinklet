import { Controller, Delete, Header, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { idSchema } from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { NamingParamPipe } from '../../infrastructure/validation/naming-param.pipe.js';
import { familyNotFound } from '../family/families.service.js';
import { FamilyDeletionService } from './family-deletion.service.js';

/**
 * `DELETE /api/families/{familyId}` (`.docs/design/interfaces.md`, "家庭"):
 * the family's admin deletes it, 204. The route takes nothing but the
 * family, so its membership and admin check is the family module's own,
 * made under the family's lock in the deletion's transaction: a parent who
 * is not a member, or a family that is not there, is 404
 * `family_not_found`, and so is a family id that is not an id; a member
 * who is not the admin is 403 `not_admin`. The other routes of the family
 * are the family module's.
 */
@Controller('families/:familyId')
export class FamilyDeletionController {
  constructor(private readonly deletion: FamilyDeletionService) {}

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async delete(
    @CurrentParentId() parentId: string,
    @Param('familyId', new NamingParamPipe(idSchema, familyNotFound)) familyId: string,
  ): Promise<void> {
    await this.deletion.delete(parentId, familyId);
  }
}
