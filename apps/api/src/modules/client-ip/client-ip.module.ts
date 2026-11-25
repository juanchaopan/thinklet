import { Module } from '@nestjs/common';
import { ClientIpController } from './client-ip.controller.js';

/** The temporary check of the client IP headers in staging (decision 0039). */
@Module({
  controllers: [ClientIpController],
})
export class ClientIpModule {}
