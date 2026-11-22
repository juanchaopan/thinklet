import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  applicantJoinRequestListSchema,
  applicantJoinRequestSchema,
  createJoinRequestRequestSchema,
  type ApplicantJoinRequest,
  type CreateJoinRequestRequest,
} from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { RequestIdPipe } from './join-request-params.js';
import { JoinRequestsService } from './join-requests.service.js';

/**
 * The signed-in parent's own requests to join families
 * (`.docs/design/interfaces.md`, "申请加入（申请人）"). Someone else's request
 * is answered as one that does not exist.
 */
@Controller('join-requests')
export class JoinRequestsController {
  constructor(private readonly joinRequestsService: JoinRequestsService) {}

  /** 201 with the new pending request. */
  @Post()
  @Header('Cache-Control', 'no-store')
  async apply(
    @CurrentParentId() parentId: string,
    @Body(new ZodValidationPipe(createJoinRequestRequestSchema)) body: CreateJoinRequestRequest,
  ): Promise<ApplicantJoinRequest> {
    return applicantJoinRequestSchema.parse(
      await this.joinRequestsService.apply(parentId, body.code),
    );
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentParentId() parentId: string): Promise<ApplicantJoinRequest[]> {
    return applicantJoinRequestListSchema.parse(await this.joinRequestsService.listOwn(parentId));
  }

  /** Withdraws the parent's pending request: 204. */
  @Delete(':requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(
    @CurrentParentId() parentId: string,
    @Param('requestId', RequestIdPipe) requestId: string,
  ): Promise<void> {
    await this.joinRequestsService.withdraw(parentId, requestId);
  }

  /** The applicant's 「知道了」 on an approved, rejected or expired request: 204. */
  @Post(':requestId/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(
    @CurrentParentId() parentId: string,
    @Param('requestId', RequestIdPipe) requestId: string,
  ): Promise<void> {
    await this.joinRequestsService.dismissOwn(parentId, requestId);
  }
}
