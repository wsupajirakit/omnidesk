import { Module } from '@nestjs/common';

import { LineQuotaApi } from './api/line-quota';
import { LinePushService } from './push/line-push';
import {
  InlineLinePushQueue,
  LinePushDispatcher,
} from './push/queue/line-push-dispatcher';

/**
 * ==== [FEAT-20260820-LINEPUSHCORE] the LINE infra module ====
 *
 * EXPORTS from day one — the exact omission that broke the last attempt:
 * `LineApiService` sits in WebhookModule's `providers` without being exported
 * (webhook.module.ts:250), which is why chat.module.ts:126 and
 * customer-link.module.ts:71 re-provide the class and broadcasts.service.ts
 * (:617-627) gave up and duplicated raw axios. บทเรียนรอบก่อน: ไม่ export = เกิด
 * สำเนาเถื่อนทั่ว repo.
 *
 * ⚠️ DELIBERATELY NOT IMPORTED BY `app.module.ts` IN PHASE 1-2. No candidate
 * is migrated yet, so the running system must not load this path at all.
 * Phase 3 wires it: add `LineModule` to the importing feature module (NOT
 * globally) — the first real caller's task, with its own approval.
 *
 * revert: delete `src/infra/line/` entirely — nothing imports it yet.
 */
@Module({
  // [FEAT-20260820-LINEPUSH25] Phase 2.5 adds the GET side (quota) and the
  // queue-ready wrapper. To swap the inline strategy for a real queue later:
  // { provide: InlineLinePushQueue, useClass: BullmqLinePushQueue } here.
  providers: [
    LinePushService,
    LineQuotaApi,
    InlineLinePushQueue,
    LinePushDispatcher,
  ],
  exports: [
    LinePushService,
    LineQuotaApi,
    InlineLinePushQueue,
    LinePushDispatcher,
  ],
})
export class LineModule {}
