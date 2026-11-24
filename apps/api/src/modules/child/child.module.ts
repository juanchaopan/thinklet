import { Module } from '@nestjs/common';
import { ChildDataModule } from '../../infrastructure/child-data/child-data.module.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { PasswordsModule } from '../../infrastructure/passwords/passwords.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FamilyModule } from '../family/family.module.js';
import { ChildLoginController } from './child-login.controller.js';
import { ChildLoginRepository } from './child-login.repository.js';
import { ChildLoginService } from './child-login.service.js';
import { ChildController } from './child.controller.js';
import { ChildGuard } from './child.guard.js';
import { ChildService } from './child.service.js';
import { ChildrenFamilyGuard } from './children-family.guard.js';
import { ChildrenController } from './children.controller.js';
import { ChildrenRepository } from './children.repository.js';
import { ChildrenService } from './children.service.js';

/**
 * Children's accounts. ChildrenService keeps the children of a family, their
 * login links and their remembered browsers, as the family's parents manage
 * them; its routes pass the family module's membership check.
 * ChildLoginService logs children in, by account, remembered browser or
 * login link, and signs them in with the auth module's ChildSessionService;
 * ChildService serves the signed-in child, whose routes pass ChildGuard.
 * The children's personal data is encrypted in the repositories with the
 * child data cipher. Other modules use ChildrenService to look up the
 * children of a family, and ChildService for its half of the child's
 * login check (`isCurrent`) on their own routes for a signed-in child.
 */
@Module({
  imports: [DatabaseModule, ChildDataModule, PasswordsModule, AuthModule, FamilyModule],
  controllers: [ChildrenController, ChildLoginController, ChildController],
  providers: [
    ChildrenRepository,
    ChildrenService,
    ChildrenFamilyGuard,
    ChildLoginRepository,
    ChildLoginService,
    ChildService,
    ChildGuard,
  ],
  exports: [ChildrenService, ChildService],
})
export class ChildModule {}
