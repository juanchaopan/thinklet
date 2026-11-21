import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { FamiliesController } from './families.controller.js';
import { FamiliesRepository } from './families.repository.js';
import { FamiliesService } from './families.service.js';
import { FamilyController } from './family.controller.js';
import { FamilyMemberGuard } from './family-member.guard.js';
import { FamilyRepository } from './family.repository.js';
import { FamilyService } from './family.service.js';
import { MeController } from './me.controller.js';

/**
 * Parents' accounts and their families. FamilyService keeps the parents and
 * is the one service other modules use; FamiliesService keeps the families,
 * their settings and their members.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [MeController, FamiliesController, FamilyController],
  providers: [
    FamilyRepository,
    FamilyService,
    FamiliesRepository,
    FamiliesService,
    FamilyMemberGuard,
  ],
  exports: [FamilyService],
})
export class FamilyModule {}
