import { Module } from '@nestjs/common';
import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

/**
 * The audit events. Other modules record their changes with AuditService,
 * passing it the transaction the change is made in; the module needs no
 * connection of its own.
 */
@Module({
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
