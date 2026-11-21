import { Body, Controller, Header, Post } from '@nestjs/common';
import {
  createFamilyRequestSchema,
  familyDetailSchema,
  type CreateFamilyRequest,
  type FamilyDetail,
} from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { FamiliesService } from './families.service.js';

/** Creating a family, open to every signed-in parent (`.docs/design/interfaces.md`, "家庭"). */
@Controller('families')
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  /** 201 with the new family; its creator is its admin. */
  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentParentId() parentId: string,
    @Body(new ZodValidationPipe(createFamilyRequestSchema)) body: CreateFamilyRequest,
  ): Promise<FamilyDetail> {
    return familyDetailSchema.parse(await this.familiesService.create(parentId, body));
  }
}
