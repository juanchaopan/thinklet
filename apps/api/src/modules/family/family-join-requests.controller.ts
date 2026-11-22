import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  familyJoinRequestsResponseSchema,
  handledJoinRequestSchema,
  type FamilyJoinRequestsResponse,
  type HandledJoinRequest,
} from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { FamilyAdmin, FamilyIdPipe, FamilyMemberGuard } from './family-member.guard.js';
import { RequestIdPipe } from './join-request-params.js';
import { JoinRequestsService, type Decision } from './join-requests.service.js';

/**
 * The family admin's new members page (`.docs/design/interfaces.md`, "新成员
 * （管理员）"). Every route passes the membership check and needs the admin;
 * a request of another family is answered as one that does not exist.
 */
@Controller('families/:familyId/join-requests')
@UseGuards(FamilyMemberGuard)
@FamilyAdmin()
export class FamilyJoinRequestsController {
  constructor(private readonly joinRequestsService: JoinRequestsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('familyId', FamilyIdPipe) familyId: string,
  ): Promise<FamilyJoinRequestsResponse> {
    return familyJoinRequestsResponseSchema.parse(
      await this.joinRequestsService.listFamily(familyId),
    );
  }

  /** 200 with the approved request; the applicant is a member of the family. */
  @Post(':requestId/approve')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  approve(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
    @Param('requestId', RequestIdPipe) requestId: string,
  ): Promise<HandledJoinRequest> {
    return this.decide(parentId, familyId, requestId, 'approved');
  }

  /** 200 with the rejected request. */
  @Post(':requestId/reject')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  reject(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
    @Param('requestId', RequestIdPipe) requestId: string,
  ): Promise<HandledJoinRequest> {
    return this.decide(parentId, familyId, requestId, 'rejected');
  }

  /** The admin's 「知道了」 on a handled request: 204. */
  @Post(':requestId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
    @Param('requestId', RequestIdPipe) requestId: string,
  ): Promise<void> {
    await this.joinRequestsService.dismissForFamily(parentId, familyId, requestId);
  }

  private async decide(
    parentId: string,
    familyId: string,
    requestId: string,
    decision: Decision,
  ): Promise<HandledJoinRequest> {
    return handledJoinRequestSchema.parse(
      await this.joinRequestsService.decide(parentId, familyId, requestId, decision),
    );
  }
}
