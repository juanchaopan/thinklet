import { Module } from '@nestjs/common';
import { ChildDataModule } from '../../infrastructure/child-data/child-data.module.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { FamilyModule } from '../family/family.module.js';
import { ChildrenFamilyGuard } from './children-family.guard.js';
import { ChildrenController } from './children.controller.js';
import { ChildrenRepository } from './children.repository.js';
import { ChildrenService } from './children.service.js';

/**
 * Children's accounts. ChildrenService keeps the children of a family, their
 * login links and their remembered browsers, as the family's parents manage
 * them; its routes pass the family module's membership check. The children's
 * personal data is encrypted in the repository with the child data cipher.
 */
@Module({
  imports: [DatabaseModule, ChildDataModule, FamilyModule],
  controllers: [ChildrenController],
  providers: [ChildrenRepository, ChildrenService, ChildrenFamilyGuard],
})
export class ChildModule {}
