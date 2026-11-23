import { Controller, Get, Header } from '@nestjs/common';
import { childMeResponseSchema, type ChildMeResponse } from '@thinklet/contracts';
import { CurrentChildId } from '../../infrastructure/authentication/current-child.js';
import { ForSignedInChild } from './child.guard.js';
import { ChildService } from './child.service.js';

/**
 * The routes of a signed-in child (`.docs/design/interfaces.md`,
 * "孩子（孩子登录后）"). Every one passes the child's login check first.
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
}
