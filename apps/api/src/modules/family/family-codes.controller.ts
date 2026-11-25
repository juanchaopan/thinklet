import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import { familyCodeLookupResponseSchema, type FamilyCodeLookupResponse } from '@thinklet/contracts';
import type { Request } from 'express';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ClientIpHeader } from '../../infrastructure/rate-limit/client-ip.js';
import { FamilyCodeLookups } from './family-code-lookups.service.js';
import { FamilyCodePipe } from './join-request-params.js';

/** Looking up a family code before applying (`.docs/design/interfaces.md`, "申请加入（申请人）"). */
@Controller('family-codes')
export class FamilyCodesController {
  constructor(
    private readonly lookups: FamilyCodeLookups,
    private readonly clientIp: ClientIpHeader,
  ) {}

  /** The family's name and its admin's name, when the parent may apply to it. */
  @Get(':code')
  @Header('Cache-Control', 'no-store')
  async lookUp(
    @CurrentParentId() parentId: string,
    @Param('code', FamilyCodePipe) code: string,
    @Req() request: Request,
  ): Promise<FamilyCodeLookupResponse> {
    return familyCodeLookupResponseSchema.parse(
      await this.lookups.lookUp(parentId, code, this.clientIp.read(request)),
    );
  }
}
