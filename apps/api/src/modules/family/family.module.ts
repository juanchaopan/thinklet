import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { RateLimitModule } from '../../infrastructure/rate-limit/rate-limit.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { FamiliesController } from './families.controller.js';
import { FamiliesRepository } from './families.repository.js';
import { FamiliesService } from './families.service.js';
import { FamilyCodeLookups } from './family-code-lookups.service.js';
import { FamilyCodesController } from './family-codes.controller.js';
import { FamilyJoinRequestsController } from './family-join-requests.controller.js';
import { FamilyController } from './family.controller.js';
import { FamilyMemberGuard } from './family-member.guard.js';
import { FamilyRepository } from './family.repository.js';
import { FamilyService } from './family.service.js';
import { JoinRequestsController } from './join-requests.controller.js';
import { JoinRequestsRepository } from './join-requests.repository.js';
import { JoinRequestsService } from './join-requests.service.js';
import { MeController } from './me.controller.js';
import { ParentDeletionService } from './parent-deletion.service.js';

/**
 * Parents' accounts and their families. FamilyService keeps the parents;
 * FamiliesService keeps the families, their settings and their members;
 * JoinRequestsService keeps the requests to join a family, from the
 * applicant's and from the admin's side, and FamilyCodeLookups limits the
 * codes a source looks up without finding. ParentDeletionService deletes a
 * parent's account here, handing over or deleting the families they are
 * the admin of. Each records its changes with the audit module. Other
 * modules use FamilyService, FamiliesService for its membership check
 * (`checkAccess`), which every route under `/api/families/{familyId}`
 * passes, those of other modules included, and for the families' codes,
 * which a child logs in with, and ParentDeletionService for the account
 * module, which deletes the account at Authing and ends the login too.
 */
@Module({
  imports: [DatabaseModule, RateLimitModule, AuditModule],
  controllers: [
    MeController,
    FamiliesController,
    FamilyController,
    FamilyCodesController,
    JoinRequestsController,
    FamilyJoinRequestsController,
  ],
  providers: [
    FamilyRepository,
    FamilyService,
    FamiliesRepository,
    FamiliesService,
    FamilyMemberGuard,
    JoinRequestsRepository,
    JoinRequestsService,
    FamilyCodeLookups,
    ParentDeletionService,
  ],
  exports: [FamilyService, FamiliesService, ParentDeletionService],
})
export class FamilyModule {}
