import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Hook, HookSchema } from '@/modules/hooks';
import { AuditModule } from '@/modules/audit';
import { Member, MemberSchema } from '@/modules/chat';
import { ImageStorage, ImageStorageSchema } from '@/modules/content';
import { ExternalModule } from '@/modules/external';
import { SystemModule } from '@/modules/system';

import { QrVisionService } from './qr-vision.service';
import {
  SlipVerification,
  SlipVerificationSchema,
} from './schemas/slip-verification.schema';
import { SlipFlowService } from './slip-flow.service';
import { SlipVerificationController } from './slip-verification.controller';
import { SlipVerificationService } from './slip-verification.service';

/**
 * Slip-verification endpoints (`/api/slip-verifications`, `slip.manage`).
 *
 * This module did not exist: the controller, service, DTOs and schema were all
 * written but never mounted, so every route answered 404 while the code looked
 * complete. Registering it here is what puts the five endpoints on the wire.
 *
 * `Member` is registered because the `line_user` virtual populates against it.
 * Mongoose resolves a `ref` by model name at populate time, so without the
 * model registered on this connection the populate throws
 * `MissingSchemaError: Schema hasn't been registered for model "Member"` —
 * at request time, not at boot. Same reason `ImageStorage` is here: the list
 * and detail handlers populate `internal_content_id` against it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SlipVerification.name, schema: SlipVerificationSchema },
      { name: Member.name, schema: MemberSchema },
      { name: ImageStorage.name, schema: ImageStorageSchema },
      // [FIX-20260818-SLIPSCOPE · plan §8] the hook-scope resolver reads Hook.
      { name: Hook.name, schema: HookSchema },
    ]),
    // The detail handler builds `external_data` from a live partner lookup —
    // see `SlipVerificationService.getById`.
    ExternalModule,
    // `SlipFlowService` logs its Swiftcheck call through `WebhookLogService`,
    // exactly as legacy:2857 does.
    SystemModule,
    // [FEAT-20260808-AUDITSITE] audit_logs writer for create/update/delete,
    // matching legacy slipVerificationController.js:4.
    AuditModule,
  ],
  controllers: [SlipVerificationController],
  /**
   * `QrVisionService` and `SlipFlowService` are the ported inbound slip flow.
   * They are registered and exported but injected NOWHERE in this repo yet —
   * `src/modules/webhook/` wires them, and that is a separate change.
   *
   * ⚠️ `QrVisionService` is the only class here that calls a generative AI
   * endpoint. Nothing in this module invokes it; see its file header.
   */
  providers: [SlipVerificationService, QrVisionService, SlipFlowService],
  exports: [SlipVerificationService, QrVisionService, SlipFlowService],
})
export class SlipModule {}
