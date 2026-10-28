/** Public surface of the audit module — import '@/modules/audit'. */

export { AuditModule } from './audit.module';
export { AuditLogController } from './audit-log.controller';
export {
  AuditLogService,
  type AuditActorInput,
  type AuditChangedFieldInput,
  type AuditPagination,
  type AuditRequestMetaInput,
  type CreateAuditLogInput,
  type ListAuditLogsOptions,
  type ListAuditLogsResult,
} from './audit-log.service';
// [FIX-20260818-SECAUDIT] plan §2.2b M3 — how auth and admin record a security
// event without either module needing to know the row's shape.
export {
  PASSWORD_CHANGED,
  SECURITY_AUDIT_PARENT,
  actorFromUser,
  recordUserSecurityEvent,
  type UserSecurityEvent,
} from './security-events';
