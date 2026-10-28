/**
 * ==== [FEAT-20260808-PAYTOOL-P2] payment module ====
 *
 * Wires the payment runner: it needs the slip (lock), the three handoff LOG
 * collections (reused byte-faithfully from legacy), the member profile (statement
 * source), the slip image (multipart file), and the custom-tool executor + signer
 * (via ExternalModule). Schemas stay owned by their own modules — this is a
 * read/write reuse, never a re-declaration of ownership.
 *
 * NOT imported by the webhook yet (Phase 3). Registered here so it builds and is
 * DI-resolvable; the runner is also constructable directly in unit tests.
 * revert: delete this module + drop it from app.module.
 */
import { Module } from '@nestjs/common';
import { RealtimeModule } from '@/infra/realtime/realtime.module';
import { MongooseModule } from '@nestjs/mongoose';

import { Member, MemberSchema } from '@/modules/chat';
import { ImageStorage, ImageStorageSchema } from '@/modules/content';
import { ExternalModule } from '@/modules/external';
import { Hook, HookSchema } from '@/modules/hooks';
import {
  ChatRoom,
  ChatRoomSchema,
} from '@/modules/chat/schemas/chat-room.schema';
// [FIX-20260811-PAYDIVIDER] เขียน divider ลง transcript ตอนห้องถูก claim อยู่แล้ว
import {
  ChatMessage,
  ChatMessageSchema,
} from '@/modules/chat/schemas/chat-message.schema';
import { Ticket, TicketSchema } from '@/modules/tickets/schemas/ticket.schema';
import {
  HandoffChainRun,
  HandoffChainRunSchema,
  HandoffJob,
  HandoffJobSchema,
  HandoffResult,
  HandoffResultSchema,
} from '@/modules/handoff';
import { SlipVerification, SlipVerificationSchema } from '@/modules/slip';

import { PaymentRunnerService } from './payment-runner.service';
// [FEAT-20260811-PAYRESPEXAMPLES] one display-only GET for the hook-modal guide.
import { PaymentController } from './payment.controller';

@Module({
  imports: [
    // [FEAT-20260810-PAYTICKET] ยิง ticket:new ให้หน้าแอดมินเด้งเอง
    RealtimeModule,
    MongooseModule.forFeature([
      { name: SlipVerification.name, schema: SlipVerificationSchema },
      { name: HandoffChainRun.name, schema: HandoffChainRunSchema },
      { name: HandoffJob.name, schema: HandoffJobSchema },
      { name: HandoffResult.name, schema: HandoffResultSchema },
      { name: Member.name, schema: MemberSchema },
      { name: ImageStorage.name, schema: ImageStorageSchema },
      // [P2C-2c] READ-ONLY, resume path only: a retry postback carries a runId,
      // so the hook is re-read to re-check the payment kill-switch before a
      // money leg. Ownership stays with the hooks module.
      { name: Hook.name, schema: HookSchema },
      // [FEAT-20260810-PAYTICKET] เปิด ticket เองเมื่อ topup ตอบ member-not-match
      //   ChatRoom = ใช้ claim ห้องแบบ atomic กันเปิดซ้ำ · Ticket = ตัวที่สร้าง
      //   revert: ลบ 2 บรรทัดนี้ + payment-ticket.helper.ts + จุดเรียกใน runner
      { name: ChatRoom.name, schema: ChatRoomSchema },
      { name: Ticket.name, schema: TicketSchema },
      /* [FIX-20260811-PAYDIVIDER] เขียน divider แถวจริงเมื่อห้องถูก claim อยู่แล้ว
         (ตรวจสลิปซ้ำระหว่างที่แอดมินถือเคส ⇒ ไม่เปิด ticket ใหม่ แต่ต้องมีเส้นคั่น)
         ลงทะเบียน schema ตรงนี้แทนการ import ChatModule ทั้งก้อน — เหตุผลเดียวกับที่
         `ticket-divider.helper.ts` เขียน `chat_messages` ตรง ๆ: เลี่ยง cross-module
         dependency (และความเสี่ยง cycle) เพื่อใช้เมธอดเดียว
         revert: ลบบรรทัดนี้ + จุดเรียก writeDivider ใน payment-ticket.helper.ts */
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
    ExternalModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentRunnerService],
  exports: [PaymentRunnerService],
})
export class PaymentModule {}
