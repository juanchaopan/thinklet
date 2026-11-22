import { Module } from '@nestjs/common';
import { PasswordHasher } from './password-hasher.js';

/** Password hashing, for the modules that keep passwords. */
@Module({
  providers: [PasswordHasher],
  exports: [PasswordHasher],
})
export class PasswordsModule {}
