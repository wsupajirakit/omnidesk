import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// [FEAT-20260827-ADMINBLOCK] see the header note on what this import changes.
import { AuditModule } from '@/modules/audit';

import {
  MemberStrikeEvent,
  MemberStrikeEventSchema,
} from './schemas/member-strike-event.schema';
import {
  MemberStrikeSession,
  MemberStrikeSessionSchema,
} from './schemas/member-strike-session.schema';
import { STRIKE_GATE } from './strike-gate.port';
import { StrikeGateService } from './strike-gate.service';
import { STRIKE_SINK } from './strike-sink.port';
import { StrikeAdminService } from './strike-admin.service';
import { StrikeController } from './strike.controller';
import { StrikeService } from './strike.service';

/**
 * [FEAT-20260824-STRIKESESSION] Strike tracking — a leaf module.
 * ===========================================================================
 * 📖 HANDOVER DOC: `docs/strike-session.md` — read that first; it is the operating
 *    manual (what it is, the API, permissions, how to switch it on and off).
 *    Design + measurements: `docs/strike-count-design.md`.
 *
 * IT IMPORTS ONE THING FROM ANOTHER FEATURE MODULE — `AuditModule`, since
 * 27/08 — and nothing else. That import is the designed exception, not a leak:
 * the audit trail is the cross-cutting sink every feature module already pulls
 * in (chat, tickets, hooks, auth, admin), its own doc says the writers "sit in
 * other feature modules", and audit imports nothing back from strike, so the
 * property the owner asked for ("แยก module / service ชัดเจน ห้ามยัด") keeps its
 * substance: this module registers only its own two schemas, stores the ids it
 * is handed, joins nothing, and deleting this folder plus its import lines
 * still removes the feature with no other file to fix. What changed is only
 * that the two admin actions (block / clear) now leave a row in
 * `hook_audit_logs` naming who pressed the button.
 * [FEAT-20260827-ADMINBLOCK] 📖 `todo/task/27082026/todo8_27082026_admin-block-suspend.md`
 *
 * `STRIKE_SINK` is exported as an alias of `StrikeService` so `webhook` can
 * inject the narrow `StrikeSink` interface instead of the whole service. That
 * keeps the webhook's dependency to a single method it is allowed to call, and
 * it is what makes the tap a no-op when this module is not imported there.
 *
 * ⚠️ REGISTERING THIS MODULE DOES CREATE THE TWO COLLECTIONS. Mongoose builds the
 * declared indexes at boot (`autoIndex`), and creating an index creates the
 * collection — observed on `local_db_10_aug_26`, 24/08/2026. An earlier comment
 * here claimed the opposite ("lazily on first write"); it was wrong.
 * What IS true, and is the property that matters: both are created EMPTY, and no
 * other collection is read or written. Nothing existing changes shape, so there
 * is nothing to migrate and nothing to undo but the two drops.
 * เอกสารเคยเขียนว่าไม่แตะ DB เลย — ผิด · boot สร้าง collection ว่างกับ index จริง
 *
 * revert: remove `StrikeModule` from `app.module.ts` (routes gone) and from
 * `webhook.module.ts` (the tap goes back to a no-op), then delete this folder.
 */
@Module({
  imports: [
    // [FEAT-20260827-ADMINBLOCK] exports AuditLogService for the controller.
    AuditModule,
    MongooseModule.forFeature([
      { name: MemberStrikeSession.name, schema: MemberStrikeSessionSchema },
      { name: MemberStrikeEvent.name, schema: MemberStrikeEventSchema },
    ]),
  ],
  controllers: [StrikeController],
  providers: [
    StrikeService,
    // The narrow seam. `useExisting` (not `useClass`) so there is exactly ONE
    // instance: the sink the webhook writes through and the service the routes
    // read through are the same object.
    { provide: STRIKE_SINK, useExisting: StrikeService },
    /* [FEAT-20260826-STRIKESUSPEND] the READ seam, bound the same way and to the
       same instance. Two tokens rather than one because they are two different
       questions with two different lifetimes: a deployment can record strikes
       without silencing anybody (which is what this repo did for two days), and
       either side can be unplugged from the webhook on its own.
       📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md` */
    StrikeGateService,
    { provide: STRIKE_GATE, useExisting: StrikeGateService },
    /* [FEAT-20260827-ADMINBLOCK] the admin write side (block). Its own class,
       not more methods on the two above — its header says why. */
    StrikeAdminService,
  ],
  exports: [StrikeService, STRIKE_SINK, STRIKE_GATE],
})
export class StrikeModule {}
