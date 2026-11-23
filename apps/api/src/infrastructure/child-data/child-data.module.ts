import { Module } from '@nestjs/common';
import { ChildDataCipher } from './child-data-cipher.js';

/** The encryption of children's personal data, for the repositories that store it. */
@Module({
  providers: [ChildDataCipher],
  exports: [ChildDataCipher],
})
export class ChildDataModule {}
