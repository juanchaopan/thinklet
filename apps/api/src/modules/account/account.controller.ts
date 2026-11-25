import { Controller, Delete, Header, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ParentSessionService } from '../auth/parent-session.service.js';
import { AccountService } from './account.service.js';

/**
 * `DELETE /api/me` (`.docs/design/interfaces.md`, "当前家长"): the signed-in
 * parent deletes their own account. Once it is deleted, at Authing and
 * here, every cookie of the parent's login is cleared and the answer is
 * 204. The other routes of `/api/me` are the family module's.
 */
@Controller('me')
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly parentSessions: ParentSessionService,
  ) {}

  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async delete(
    @CurrentParentId() parentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.accounts.deleteOwnAccount(parentId);
    this.parentSessions.end(response);
  }
}
