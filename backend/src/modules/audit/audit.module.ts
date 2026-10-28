import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// [FEAT-20260808-AUDITSITE] Leaf-file imports, not the '@/modules/hooks' barrel:
// HooksModule imports AuditModule now, and the barrel would close the cycle
// hooks -> audit -> hooks (see audit-log.service.ts for the full note).
import {
  HookAuditLog,
  HookAuditLogSchema,
} from '@/modules/hooks/schemas/hook-audit-log.schema';
import { Hook, HookSchema } from '@/modules/hooks/schemas/hook.schema';

// [FIX-20260810-QCACHEIMPORT] AuditLogController injects ScopedQueryCacheService.
// QueryCacheModule is @Global, but @Global only publishes a provider once the module
// is in the graph — AppModule imports it, so the running app is fine, while a
// TestingModule that assembles this module directly is not. That gap made every e2e
// suite here fail with "Nest can't resolve dependencies of the AuditLogController".
// Importing it explicitly costs nothing (@Global de-duplicates) and makes the module
// declare the dependency it actually has. โมดูลต้องประกาศของที่ตัวเองใช้ ไม่ฝากไว้กับ global
import { QueryCacheModule } from '@/infra/query-cache/query-cache.module';

import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/**
 * The audit trail gets its own module rather than living inside hooks, because
 * its two consumers pull in opposite directions: the endpoints are root-mounted
 * and generic, while the writers (flex cards today, more later) sit in other
 * feature modules and need the service without dragging in hook routing.
 *
 * `AuditLogService` is exported for exactly that reason.
 */
@Module({
  imports: [
    QueryCacheModule, // [FIX-20260810-QCACHEIMPORT] see the note on the import
    MongooseModule.forFeature([
      { name: HookAuditLog.name, schema: HookAuditLogSchema },
      // Needed by the list endpoint's OA access check, not by the log itself.
      { name: Hook.name, schema: HookSchema },
    ]),
  ],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService, MongooseModule],
})
export class AuditModule {}
