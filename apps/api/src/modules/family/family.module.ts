import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { FamiliesController } from './families.controller.js';
import { FamiliesRepository } from './families.repository.js';
import { FamiliesService } from './families.service.js';
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

/**
 * Parents' accounts and their families. FamilyService keeps the parents and
 * is the one service other modules use; FamiliesService keeps the families,
 * their settings and their members; JoinRequestsService keeps the requests
 * to join a family, from the applicant's and from the admin's side.
 */
@Module({
  imports: [DatabaseModule],
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
  ],
  exports: [FamilyService],
})
export class FamilyModule {}
