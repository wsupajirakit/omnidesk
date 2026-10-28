/**
 * [FEAT-20260918-AUTOTRANS] The INBOUND wrapper — one of two, around one core.
 * =============================================================================
 * The translator itself is not here and must never be duplicated here. This file
 * answers three questions and then hands the work to `ChatTranslateService`, the
 * single core that owns the vendor call, the cap ledger, the cache and the audit
 * row: *does this message qualify · into which language · what happens when it
 * fails*. ตัวแปลมีตัวเดียว ที่นี่แค่ห่อ
 *
 * ## What "inbound" means and why it is not the same as outbound
 *
 * | | inbound (this file) | outbound (the send path) |
 * |---|---|---|
 * | who reads the result | the operator | the customer |
 * | target language | what the operator reads (room → hook → `th`) | the customer's language |
 * | may it block? | **no** — the bubble is already on screen | **yes** — nothing can be sent until the text exists |
 * | on failure | keep the original, no entry, stay quiet | send the original as typed |
 *
 * Two wrappers, not one with a flag: every row of that table differs.
 *
 * ## Failure is a first-class outcome, not an exception
 *
 * Owner, 18/09: *"ต้องมี fallback ด้วย กรณีแปลไม่สำเร็จ (ทุกกรณี) ก็เก็บแบบเดิม ไม่งง"*.
 * Vendor down, cap ledger full, OA has no key, the model returns nonsense, Mongo
 * hiccups — every one of them lands in the same place: the message keeps the
 * text the customer sent, carries no translation entry, and nobody is shown an
 * error. The only trace is a WARN line naming the reason, because a silent
 * nothing is impossible to debug later.
 *
 * revert: delete `translate/auto/`, the optional 6th constructor argument in
 * `chat-history.service.ts` and its provider entry in `chat.module.ts`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import { Hook, type HookDocument } from '@/modules/hooks';

import {
  ChatRoom,
  type ChatRoomDocument,
} from '../../schemas/chat-room.schema';
import { ChatTranslateService } from '../chat-translate.service';
import type {
  AutoTranslateInboundInput,
  AutoTranslateInboundPort,
} from './auto-translate.port';
import {
  inboundTextRefusal,
  shouldAutoTranslateInbound,
} from './should-auto-translate';

@Injectable()
export class AutoTranslateInboundService implements AutoTranslateInboundPort {
  private readonly logger = new Logger(AutoTranslateInboundService.name);

  constructor(
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    private readonly translate: ChatTranslateService,
    /* Tells an open room that a bubble it is already showing now has a
       translation under it. Never awaited for success — see the call site. */
    private readonly realtime: RealtimePublisherService,
  ) {}

  public async onInboundMessage(
    input: AutoTranslateInboundInput,
  ): Promise<string | null> {
    try {
      /* The message decides first, the settings second — and in that order the
         room and hook are never read for a message that could not qualify
         anyway. A bot card, an emoji or an admin's own line costs zero lookups.
         ไม่เข้าเงื่อนไข = ไม่แตะ DB เลย */
      const refusal = inboundTextRefusal({
        senderType: input.senderType,
        messageType: input.messageType,
        content: input.text,
      });
      if (refusal) return null;

      const room = await this.chatRoomModel
        .findById(input.roomId)
        .select('translate_lang auto_translate')
        .lean();
      if (!room) return null;

      const hook = input.hookId
        ? await this.hookModel
            .findById(input.hookId)
            .select('translate_lang auto_translate')
            .lean()
        : null;

      const decision = shouldAutoTranslateInbound({
        senderType: input.senderType,
        messageType: input.messageType,
        content: input.text,
        room,
        hook,
      });
      if (!decision.translate) {
        this.logger.debug?.(
          `[AUTOTRANS] skip ${input.messageId}: ${decision.reason}`,
        );
        return null;
      }

      /* The core. `'system'` because no operator pressed anything — see the
         argument's note in `chat-translate.service.ts`. Everything that makes a
         manual press correct (the per-language cache, the cap ledger, the audit
         row, the stored entry shape) is inherited by being this call. */
      const result = await this.translate.translateMessage(
        input.messageId,
        { to: decision.to },
        undefined,
        'system',
      );

      /* The bubble went out seconds ago carrying the original. Tell the rooms
         that are open so the translation appears under it without a refresh —
         the same `message:updated` event the video and flex rewrites already
         use, so the gateway, the FE hook and its union type all stay untouched.

         🔴 NO hook_id ⇒ NO PUBLISH. `hook_id` is how the gateway decides who may
         receive an event; a payload without it is delivered to every connected
         operator in the environment, other tenants included. A missing one is a
         reason to stay silent, never to send anyway.
         ไม่มี hook_id = ไม่ยิง · ไม่ใช่ยิงแบบไม่ระบุ */
      if (input.hookId) {
        await this.realtime
          .publish('message:updated', {
            hook_id: input.hookId,
            _id: input.messageId,
            room_id: input.roomId,
            message_type: 'text',
            translations: [result.data],
          })
          .catch(() => undefined);
      }

      return decision.to;
    } catch (err) {
      /* 🔴 THE FALLBACK. Whatever went wrong, the message stays exactly as it
         was stored — original text, no translation entry, no error anywhere the
         customer or the operator can see. แปลไม่ผ่าน = เก็บของเดิม ไม่พัง */
      this.logger.warn(
        `[AUTOTRANS] left ${input.messageId} untranslated: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
