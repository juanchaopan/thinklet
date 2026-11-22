import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  familyDetailSchema,
  idSchema,
  transferAdminRequestSchema,
  updateFamilyRequestSchema,
  type FamilyDetail,
  type TransferAdminRequest,
  type UpdateFamilyRequest,
} from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { FamiliesService } from './families.service.js';
import { FamilyAdmin, FamilyIdPipe, FamilyMemberGuard } from './family-member.guard.js';

/**
 * One family's settings and parents (`.docs/design/interfaces.md`, "家庭").
 * Every route passes the membership check first.
 */
@Controller('families/:familyId')
@UseGuards(FamilyMemberGuard)
export class FamilyController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
  ): Promise<FamilyDetail> {
    return familyDetailSchema.parse(await this.familiesService.get(parentId, familyId));
  }

  @Patch()
  @FamilyAdmin()
  @Header('Cache-Control', 'no-store')
  async update(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
    @Body(new ZodValidationPipe(updateFamilyRequestSchema)) body: UpdateFamilyRequest,
  ): Promise<FamilyDetail> {
    return familyDetailSchema.parse(await this.familiesService.update(parentId, familyId, body));
  }

  /** 200 with the family and its new code. */
  @Post('code')
  @FamilyAdmin()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async changeCode(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
  ): Promise<FamilyDetail> {
    return familyDetailSchema.parse(await this.familiesService.changeCode(parentId, familyId));
  }

  @Put('admin')
  @FamilyAdmin()
  @Header('Cache-Control', 'no-store')
  async transferAdmin(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
    @Body(new ZodValidationPipe(transferAdminRequestSchema)) body: TransferAdminRequest,
  ): Promise<FamilyDetail> {
    return familyDetailSchema.parse(
      await this.familiesService.transferAdmin(parentId, familyId, body.parentId),
    );
  }

  /** The admin takes out another member, or a member leaves: 204. */
  @Delete('members/:parentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentParentId() parentId: string,
    @Param('familyId', FamilyIdPipe) familyId: string,
    @Param('parentId', new ZodValidationPipe(idSchema)) memberId: string,
  ): Promise<void> {
    await this.familiesService.removeMember(parentId, familyId, memberId);
  }
}
