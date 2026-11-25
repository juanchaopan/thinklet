import { Body, Controller, Get, Header, Patch } from '@nestjs/common';
import {
  childMeResponseSchema,
  updateChildMeRequestSchema,
  type ChildMeResponse,
  type UpdateChildMeRequest,
} from '@thinklet/contracts';
import { CurrentChildId } from '../../infrastructure/authentication/current-child.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { ForSignedInChild } from './child.guard.js';
import { ChildService } from './child.service.js';

/**
 * The routes of a signed-in child (`.docs/design/interfaces.md`,
 * "孩子（孩子登录后）"). Every one passes the child's login check first,
 * and acts on the child of the login only: no route names a child.
 */
@Controller('child')
@ForSignedInChild()
export class ChildController {
  constructor(private readonly childService: ChildService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@CurrentChildId() childId: string): Promise<ChildMeResponse> {
    return childMeResponseSchema.parse(await this.childService.me(childId));
  }

  @Patch('me')
  @Header('Cache-Control', 'no-store')
  async update(
    @CurrentChildId() childId: string,
    @Body(new ZodValidationPipe(updateChildMeRequestSchema)) body: UpdateChildMeRequest,
  ): Promise<ChildMeResponse> {
    return childMeResponseSchema.parse(await this.childService.rename(childId, body.nickname));
  }
}
