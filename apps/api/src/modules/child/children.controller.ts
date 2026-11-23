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
  UseGuards,
} from '@nestjs/common';
import {
  addChildRequestSchema,
  childDeviceListSchema,
  childListSchema,
  childLoginLinkSchema,
  childLoginLinkStatusResponseSchema,
  childSchema,
  updateChildRequestSchema,
  type AddChildRequest,
  type Child,
  type ChildDevice,
  type ChildLoginLink,
  type ChildLoginLinkStatusResponse,
  type UpdateChildRequest,
} from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { ChildrenFamilyGuard } from './children-family.guard.js';
import { childIdPipe, deviceIdPipe, familyIdPipe, linkIdPipe } from './children-params.js';
import { ChildrenService } from './children.service.js';

/**
 * The children of a family as its parents manage them
 * (`.docs/design/interfaces.md`, "孩子（家长）"). Every route passes the
 * family's membership check first; every member may use them.
 */
@Controller('families/:familyId/children')
@UseGuards(ChildrenFamilyGuard)
export class ChildrenController {
  constructor(private readonly childrenService: ChildrenService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Param('familyId', familyIdPipe) familyId: string): Promise<Child[]> {
    return childListSchema.parse(await this.childrenService.list(familyId));
  }

  /** 201 with the new child, who has no password yet. */
  @Post()
  @Header('Cache-Control', 'no-store')
  async add(
    @CurrentParentId() parentId: string,
    @Param('familyId', familyIdPipe) familyId: string,
    @Body(new ZodValidationPipe(addChildRequestSchema)) body: AddChildRequest,
  ): Promise<Child> {
    return childSchema.parse(await this.childrenService.add(parentId, familyId, body));
  }

  @Patch(':childId')
  @Header('Cache-Control', 'no-store')
  async update(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
    @Body(new ZodValidationPipe(updateChildRequestSchema)) body: UpdateChildRequest,
  ): Promise<Child> {
    return childSchema.parse(await this.childrenService.update(familyId, childId, body));
  }

  @Delete(':childId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
  ): Promise<void> {
    await this.childrenService.remove(familyId, childId);
  }

  @Post(':childId/password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
  ): Promise<void> {
    await this.childrenService.resetPassword(familyId, childId);
  }

  /** 201 with the new link; its token appears in no other response. */
  @Post(':childId/login-links')
  @Header('Cache-Control', 'no-store')
  async createLoginLink(
    @CurrentParentId() parentId: string,
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
  ): Promise<ChildLoginLink> {
    return childLoginLinkSchema.parse(
      await this.childrenService.createLoginLink(parentId, familyId, childId),
    );
  }

  @Get(':childId/login-links/:linkId')
  @Header('Cache-Control', 'no-store')
  async getLoginLinkStatus(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
    @Param('linkId', linkIdPipe) linkId: string,
  ): Promise<ChildLoginLinkStatusResponse> {
    return childLoginLinkStatusResponseSchema.parse(
      await this.childrenService.getLoginLinkStatus(familyId, childId, linkId),
    );
  }

  @Get(':childId/devices')
  @Header('Cache-Control', 'no-store')
  async listDevices(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
  ): Promise<ChildDevice[]> {
    return childDeviceListSchema.parse(await this.childrenService.listDevices(familyId, childId));
  }

  /** 204 also when the device is gone already. */
  @Delete(':childId/devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeDevice(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
    @Param('deviceId', deviceIdPipe) deviceId: string | undefined,
  ): Promise<void> {
    await this.childrenService.revokeDevice(familyId, childId, deviceId);
  }

  @Delete(':childId/devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAllDevices(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('childId', childIdPipe) childId: string,
  ): Promise<void> {
    await this.childrenService.revokeAllDevices(familyId, childId);
  }
}
