/**
 * [FEAT-20260825-HELPERTRIGGER] ตัวเขียน stamp `customer_helper_trigger_at`
 * ===========================================================================
 * [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
 * TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.
 *
 * THIS FILE WRITES `follow_up.line.customer_helper_trigger_at`, and it is the
 * only writer.
 *
 * ── BOTH ENDS ─────────────────────────────────────────────────────────────
 * WRITE — WHO TAKES IT: no TypeScript reader, and two real consumers. It was
 *       declared ahead of a reader on purpose, the same way the `notice_*`
 *       stamps were: a timestamp that was never recorded cannot be
 *       reconstructed later, so the recording starts first. What already
 *       consumes it — neither of them through the member-config door:
 *         1. BROADCAST / MULTICAST TARGETING. The audience source
 *            `follow_up.customer_helper_at`
 *            (`content/audience/sources/audience-source.registry.ts`) points
 *            its `path` at this key and the filter builder puts that dotted
 *            path straight into a Mongo query. A QUERY, not a code reader ⇒
 *            `assertMemberConfigKey` never runs for it and the consumers spec
 *            cannot see it either.
 *         2. THE ADMIN'S FOLLOW-UP CARD, third of three conditional alert
 *            rows: `omnidesk-console/components/member/follow-up/
 *            followStamps.ts`, reached by the same dotted path off the room
 *            payload that `/api/chat/contacts` already returns.
 *       🔴 SO A RENAME HERE IS A CROSS-REPO CHANGE, AND IT FAILS SILENTLY.
 *       Grep the DOTTED STRING `follow_up.line.customer_helper_trigger_at`
 *       across `omnidesk-api` AND `omnidesk-console` before touching the
 *       constant — the constant name alone finds neither consumer.
 *       ⚠️ AND WHAT THOSE CAMPAIGNS ACTUALLY RUN IS WIDER THAN THIS FILE:
 *       `content/audience/sources/force-no-profile.policy.ts` ANDs "and has no
 *       profile" onto any job mentioning that source, because the value below
 *       survives registration. Switch that policy off and every campaign built
 *       on this stamp starts reaching customers who linked their account long
 *       ago — nothing warns, and this file will not have changed.
 * CLEAR: NOBODY, AND THAT IS THE DESIGN — owner: *"ไม่มีเคลียร์ เก็บไว้"*.
 *       ⇒ IT IS HISTORY, NEVER A STATUS. It survives registration, so it can
 *       never answer "has this customer linked their account?" — that is
 *       `members.raw_profile_data`, and even that has a hole once an admin has
 *       wiped a profile. Both rules live at
 *       `src/modules/chat/config/member-config.registry.ts`
 *       ([DOC-20260825-REGSTATUS]); the plain-language overview of the whole
 *       follow-up feature is `docs/follow-up-status-spec.md`.
 *
 * ⭐ OVERWRITES, NEVER "ONCE". `writeMemberConfig` is the overwriting door;
 * `writeMemberConfigOnce` would freeze the first offer for ever and the key
 * would answer a different question than the one asked. เข้าเงื่อนไขเมื่อไหร่ ทับเลย.
 *
 * 🔴 SEAMLESS — THIS MUST NEVER COST A CUSTOMER THEIR REPLY. Owner:
 * *"ห้ามกระทบส่วนอื่นเด็ดขาด seamless ห้ามพังระบบ"*. Three things enforce it:
 *   1. it is called AFTER the reply has already gone out, so nothing it does
 *      can delay or block the message;
 *   2. every error is swallowed and logged — a failed stamp is a lost note,
 *      not a lost reply;
 *   3. it is fire-and-forget at the call site (`void`), so the webhook does not
 *      await it at all.
 * The worst case is a missing timestamp, which is exactly what the worst case
 * should be.
 *
 * revert: ลบไฟล์นี้ + `customer-helper-trigger.rule.ts` + สองบรรทัดในบาร์เรล
 *         + บล็อก [FEAT-20260825-HELPERTRIGGER] ใน webhook.service.ts
 */
import type { Model } from 'mongoose';

import { writeMemberConfig } from '../../chat/config';

import { CUSTOMER_HELPER_TRIGGER_KEY } from './follow-up.keys';
import { shouldStampCustomerHelper } from './customer-helper-trigger.rule';

export { CUSTOMER_HELPER_TRIGGER_KEY };

export interface CustomerHelperStampDeps {
  memberModel: Model<Record<string, unknown>>;
  /** LINE user id ของลูกค้า — ตัวเดียวกับที่ทั้ง webhook ใช้หา member */
  channelUserId: string;
  /** รอบนี้เสนอ customer-helper ไหม (`useHelperQr` ฝั่งเรียก) */
  offered: boolean;
  /** LINE รับไปแล้วจริงไหม */
  sent: boolean;
  /** เวลาที่จะประทับ — ฉีดเข้ามาเพื่อให้เทสกำหนดเองได้ ไม่ต้องยึดนาฬิกาเครื่อง */
  now?: Date;
  warn: (msg: string) => void;
}

/**
 * ประทับเวลาถ้าเข้าเงื่อนไข
 *
 * @returns `true` เมื่อเขียนสำเร็จจริง · `false` ทุกกรณีอื่น รวมถึงตอนพัง
 */
export async function stampCustomerHelperTrigger(
  deps: CustomerHelperStampDeps,
): Promise<boolean> {
  if (!shouldStampCustomerHelper(deps.offered, deps.sent)) return false;
  /* ไม่มี id = หา member ไม่ได้ · `updateOne` ด้วย filter ว่างจะไปโดนแถวแรกที่เจอ
     ซึ่งคือการเขียนทับข้อมูลคนอื่น — กันไว้ตั้งแต่ต้นทาง */
  const id = String(deps.channelUserId ?? '').trim();
  if (!id) return false;

  try {
    return await writeMemberConfig(
      { line_user_id: id },
      CUSTOMER_HELPER_TRIGGER_KEY,
      deps.now ?? new Date(),
      { memberModel: deps.memberModel },
    );
  } catch (e) {
    /* 🔴 กลืน error เสมอ — ข้อความถูกส่งไปหาลูกค้าแล้ว การจดบันทึกไม่สำเร็จ
       ต้องไม่กลายเป็น webhook error ที่ทำให้ LINE ส่งซ้ำหรือขึ้นแดงในระบบ */
    deps.warn(
      `[HELPERTRIGGER] stamp ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
