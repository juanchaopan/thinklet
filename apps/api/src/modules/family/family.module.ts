import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { FamilyRepository } from './family.repository.js';
import { FamilyService } from './family.service.js';
import { MeController } from './me.controller.js';

/** Parents' accounts and their families; other modules use only FamilyService. */
@Module({
  imports: [DatabaseModule],
  controllers: [MeController],
  providers: [FamilyRepository, FamilyService],
  exports: [FamilyService],
})
export class FamilyModule {}
