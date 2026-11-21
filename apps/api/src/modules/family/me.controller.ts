import { Body, Controller, Get, Header, Patch } from '@nestjs/common';
import {
  meResponseSchema,
  updateMeRequestSchema,
  type MeResponse,
  type UpdateMeRequest,
} from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { FamilyService } from './family.service.js';

/** The signed-in parent (`.docs/design/interfaces.md`, "当前家长"). */
@Controller('me')
export class MeController {
  constructor(private readonly familyService: FamilyService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@CurrentParentId() parentId: string): Promise<MeResponse> {
    return meResponseSchema.parse(await this.familyService.getMe(parentId));
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  async update(
    @CurrentParentId() parentId: string,
    @Body(new ZodValidationPipe(updateMeRequestSchema)) body: UpdateMeRequest,
  ): Promise<MeResponse> {
    return meResponseSchema.parse(await this.familyService.updateName(parentId, body.name));
  }
}
