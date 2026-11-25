import { Module } from '@nestjs/common';
import { ChildDataModule } from '../../infrastructure/child-data/child-data.module.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { PasswordsModule } from '../../infrastructure/passwords/passwords.module.js';
import { RateLimitModule } from '../../infrastructure/rate-limit/rate-limit.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FamilyModule } from '../family/family.module.js';
import { ChildLoginController } from './child-login.controller.js';
import { ChildLoginRepository } from './child-login.repository.js';
import { ChildLoginService } from './child-login.service.js';
import { ChildPasswords } from './child-passwords.js';
import { ChildController } from './child.controller.js';
import { ChildGuard } from './child.guard.js';
import { ChildService } from './child.service.js';
import { ChildrenFamilyGuard } from './children-family.guard.js';
import { ChildrenController } from './children.controller.js';
import { ChildrenRepository } from './children.repository.js';
import { ChildrenService } from './children.service.js';
import { LoginLinks } from './login-links.js';

/**
 * Children's accounts. ChildrenService keeps the children of a family, their
 * login links and their remembered browsers, as the family's parents manage
 * them; its routes pass the family module's membership check.
 * ChildLoginService logs children in, by account, remembered browser or
 * login link, and signs them in with the auth module's ChildSessionService;
 * ChildPasswords hashes and verifies the passwords children type and limits
 * the logins that check one per source. ChildService serves the signed-in
 * child, whose routes pass ChildGuard. The changes are recorded with the
 * audit module. The children's personal data is encrypted in the
 * repositories with the child data cipher; the login links live in Redis,
 * in LoginLinks. Other modules use ChildrenService to look up the children
 * of a family, ChildService for its half of the child's login check
 * (`currentAt`) on their own routes for a signed-in child, and LoginLinks
 * to remove the links of the children they delete.
 */
@Module({
  imports: [
    DatabaseModule,
    ChildDataModule,
    PasswordsModule,
    RateLimitModule,
    RedisModule,
    AuditModule,
    AuthModule,
    FamilyModule,
  ],
  controllers: [ChildrenController, ChildLoginController, ChildController],
  providers: [
    ChildrenRepository,
    ChildrenService,
    ChildrenFamilyGuard,
    ChildPasswords,
    ChildLoginRepository,
    ChildLoginService,
    ChildService,
    ChildGuard,
    LoginLinks,
  ],
  exports: [ChildrenService, ChildService, LoginLinks],
})
export class ChildModule {}
