import { Controller, Get, Header, Param } from '@nestjs/common';
import { familyCodeLookupResponseSchema, type FamilyCodeLookupResponse } from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { FamilyCodePipe } from './join-request-params.js';
import { JoinRequestsService } from './join-requests.service.js';

/** Looking up a family code before applying (`.docs/design/interfaces.md`, "申请加入（申请人）"). */
@Controller('family-codes')
export class FamilyCodesController {
  constructor(private readonly joinRequestsService: JoinRequestsService) {}

  /** The family's name and its admin's name, when the parent may apply to it. */
  @Get(':code')
  @Header('Cache-Control', 'no-store')
  async lookUp(
    @CurrentParentId() parentId: string,
    @Param('code', FamilyCodePipe) code: string,
  ): Promise<FamilyCodeLookupResponse> {
    return familyCodeLookupResponseSchema.parse(
      await this.joinRequestsService.lookUp(parentId, code),
    );
  }
}
