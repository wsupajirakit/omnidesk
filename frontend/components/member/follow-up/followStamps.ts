/**
 * [FEAT-20260824-FOLLOWUP] ตัวอ่าน stamp "การติดตาม" ของลูกค้า
 * ===========================================================================
 * WHAT: อ่าน `user_data.config.follow_up.line.*` ออกจาก room แล้วคืนเป็นแถวพร้อมแสดง
 *       (ป้ายไทย + เวลาแบบกรุงเทพ) ให้การ์ด `FollowUpCard` เอาไปวางอย่างเดียว
 *
 * WHY แยกไฟล์: ตรรกะ "อ่าน + แปลงเวลา" ทดสอบได้โดยไม่ต้อง render และการ์ดจะได้
 *       เหลือแต่ markup — เพิ่ม stamp ใบใหม่ = เติมหนึ่งบรรทัดใน FOLLOW_ROWS
 *       ไม่ต้องแตะ jsx เลย (นี่คือส่วน "สเกลง่าย" ที่เจ้าของสั่ง)
 *
 * ⚠️ ค่าใน DB เป็น UTC และนั่นถูกแล้ว — DB ต้องไม่เก็บเวลานาฬิกากรุงเทพ
 *    การแปลงเป็น +07:00 เกิดตอนแสดงผลเท่านั้น (timeZone: 'Asia/Bangkok')
 *    ยืนยันจากแถวจริง: `2026-08-22T16:30:00.000Z` = 22/08/2026 23:30 ที่กรุงเทพ
 *
 * WHERE THE DATA COMES FROM — ไม่ต้องแก้ฝั่ง BE เลยแม้แต่บรรทัดเดียว
 *    `/api/chat/contacts` $lookup ทั้ง member document โดยไม่ $project
 *    (omnidesk-api chat.service.ts:1423-1430) ⇒ `config.follow_up.line.*` ติดมาอยู่แล้ว
 *    ทางเดียวกันเป๊ะกับที่ components/contact/ContactHeaderInfo.tsx ใช้อยู่
 *    ⚠️ จงใจ**ไม่**สร้าง service method ใหม่ / ไม่ยิง API เพิ่ม — ข้อมูลมากับ room แล้ว
 *
 * ใครประทับ stamp พวกนี้ (เคส A–F ดู components/hook/form/NoticeCaseInfoModal.tsx):
 *    notice_deposit_at  = เคส A/B  ระบบส่งการ์ดเตือน "ฝาก" ครั้งล่าสุด
 *    notice_withdraw_at = เคส C/D  การ์ดเตือน "ถอน" ครั้งล่าสุด
 *    (notice_payment_at / request_reg_at มีอยู่ใน DB แต่ **ไม่แสดง** — ดูเหตุผลที่ FOLLOW_ROWS)
 *
 * 📖 ภาพรวมทั้งฟีเจอร์ (ฝั่ง BE เป็นคนเขียนไว้ อ่านคนเดียวจบ ไม่ต้องเปิดโค้ด):
 *    `omnidesk-api/docs/follow-up-status-spec.md` — ป้ายไหนแปลว่าอะไร · ดูสถานะได้
 *    จากกี่ที่และแต่ละที่ตอบคนละคำถามยังไง · เลขจริงจากฐานข้อมูล
 *    กติกาของคีย์ (FLAG/RECORD · ใครเขียน ใครลบ · ทำไม stamp ไม่ใช่สถานะ):
 *    `omnidesk-api/src/modules/chat/config/member-config.registry.ts`
 *
 * revert: ลบโฟลเดอร์ components/member/follow-up/ ทั้งอัน แล้วลบบล็อก
 *         [FEAT-20260824-FOLLOWUP] (import + <FollowUpCard/>) ใน
 *         components/member/CustomerCards.tsx และลบ test/followUpCard.dom.test.tsx
 */
import type { ChatRoom } from '../../../services/chat';

/** แถวที่การ์ดแสดง — เรียงตามนี้บนจอ · เพิ่ม stamp ใหม่ = เติมที่นี่ที่เดียว */
export const FOLLOW_ROWS = [
  { key: 'notice_deposit_at', label: 'ติดตามฝาก' },
  { key: 'notice_withdraw_at', label: 'ติดตามถอน' },
  /* ⛔ เจ้าของสั่งตัดออก 24/08/2026 — เหลือแค่ 2 แถวบน
     `notice_payment_at` เคยถูกตั้งป้ายว่า "ติดตามสลิป" ซึ่ง **ผิด**:
     ของจริงคือเวลาที่ระบบส่งการ์ด ALL OFF-TIME / ALL DISABLE (เคส E/F —
     omnidesk-api/src/modules/webhook/notice-runtime/cases/case-e-all-offtime.ts)
     ป้ายที่ระบบใช้จริงคือ "เคยได้รับแจ้งเตือนเรื่องการชำระ"
     (audience-source.registry.ts) ⇒ ป้ายเดิมสื่อผิดความหมาย เจ้าของจึงให้ซ่อน
     `request_reg_at` (ชวนลงทะเบียน) ถูกตัดพร้อมกันในคำสั่งเดียวกัน
     revert: เติมสองบรรทัดนี้กลับเข้าลิสต์ — jsx ไม่ต้องแตะ
       { key: 'notice_payment_at', label: 'เคยได้รับแจ้งเตือนเรื่องการชำระ' },
       { key: 'request_reg_at', label: 'ขอข้อมูลลูกค้าแล้วแต่ยังไม่ลงทะเบียน' },

     [UI-20260825-REGLABELS] ป้ายในสองบรรทัดที่ถูกซ่อนข้างบนถูกแก้ให้ถูกต้องแล้ว
     (25/08) เผื่อวันไหนเปิดกลับ จะได้ไม่กลับมาพร้อมคำเดิมที่สื่อผิด
     ⚠️ แต่ **ยังซ่อนอยู่เหมือนเดิม** — การเปลี่ยนป้ายไม่ได้เปิดแถวกลับมา
        ถ้าต้องการให้แสดงจริง ต้องย้ายบรรทัดนั้นออกมานอกคอมเมนต์
     ⚠️ ถ้าเปิด `request_reg_at` กลับมา ต้องรู้ว่ามันเป็น RECORD ที่ไม่มีใครลบ
        ⇒ ลูกค้าที่สมัครไปแล้วก็ยังโชว์แถวนี้ตลอดไป · ถ้าอยากได้ความหมาย
        "ยังค้างอยู่จริง" ให้ใช้ ABANDON_ROW ซึ่งเช็ค raw_profile_data ประกอบ */
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   [FEAT-20260825-ABANDONSTAT] แถวเตือน "ชวนลงทะเบียนแล้วยังไม่ทำ"

   ไม่ได้อยู่ใน FOLLOW_ROWS เพราะ **มีเงื่อนไข** — สองแถวข้างบนแสดงเสมอ
   (มีบ้าง n/a บ้าง) แต่แถวนี้แสดงเฉพาะตอนที่มันเป็นเรื่องจริงอยู่
   เจ้าของ 25/08: *"ถ้า member no profile + ชวนลงทะเบียนแล้วยังไม่ทำ มีค่า date
   จะแสดง label ชวนลงทะเบียนแล้วยังไม่ทำ : <datetime>"*
   ═══════════════════════════════════════════════════════════════════════════ */
export const ABANDON_ROW = {
  key: 'abandon_trigger_at',
  /* [UI-20260825-REGLABELS] ⚠️ คำนี้ต้องตรงกับ `label_th` ของ
     `follow_up.abandon_at` ใน `audience-source.registry.ts` ฝั่ง BE **เป๊ะ**
     แอดมินคนเดียวกันอ่านสองที่ (การ์ดนี้ กับ ตัวกรองตอนสร้าง broadcast)
     คำต่างกันเมื่อไหร่ = นึกว่าเป็นคนละเงื่อนไข แล้วเลือกผิดกลุ่มผู้รับ
     (มีเทสกันหลุดที่ `test/audienceSeamDrift.value.test.ts`) */
  label: 'เคยถูกชวนให้ลงทะเบียน แต่ยังไม่ลงทะเบียน',
} as const;

/* [UI-20260825-REGROWS] แถวเตือนใบที่สอง
   ⚠️ ป้ายนี้**เขียนเงื่อนไขไว้ในตัวเอง** — คำว่า "แต่ยังไม่ลงทะเบียน" จะจริง
      ก็ต่อเมื่อเช็ค `raw_profile_data` ประกอบ · `request_reg_at` เป็น RECORD
      ที่ไม่มีใครลบเลย ⇒ ถ้าโชว์ตามการมี stamp อย่างเดียว ลูกค้าที่สมัครไปแล้ว
      เมื่อเดือนก่อนจะยังโชว์แถวที่บอกว่าเขายังไม่สมัคร แล้วแอดมินจะไปทวงซ้ำ
   ⇒ จึงใช้กติกาเดียวกับใบบน ผ่าน `alertRowsFor()` ที่เดียว ไม่เขียนซ้ำ */
export const REQUEST_REG_ROW = {
  key: 'request_reg_at',
  label: 'ขอข้อมูลลูกค้าแล้วแต่ยังไม่ลงทะเบียน',
} as const;

/* [FEAT-20260825-HELPERTRIGGER] แถวเตือนใบที่สาม
   ⚠️ ป้ายต้องตรงกับ `label_th` ของ source `follow_up.customer_helper_at`
      ฝั่ง BE เป๊ะ (มีเทสกันหลุด) — แอดมินคนเดียวกันอ่านสองที่
   ⚠️ stamp ตัวนี้เป็น ROLLING RECORD: ทับทุกครั้งที่เสนอการ์ด และไม่มีใครลบ
      ⇒ เวลาที่เห็นคือ "เสนอครั้งล่าสุด" ไม่ใช่ "ครั้งแรก" · และคนที่ผูกข้อมูล
      แล้วก็ยังมี stamp ค้างอยู่ ⇒ **ต้องผ่าน `alertRowsFor` ซึ่งเช็ค
      raw_profile_data ให้** ห้ามหยิบไปแสดงตรง ๆ

   ── ค่านี้มาจากไหน (ประวัติเต็ม เผื่อวันที่แถวนี้ว่างแล้วต้องไปตามหาเหตุ) ──────
   เขียนโดย **เส้นทาง reply ของ webhook** ฝั่ง BE ผ่าน
   `omnidesk-api/src/modules/webhook/follow-up/customer-helper-trigger.helper.ts`
   ซึ่งเป็นตัวเขียนตัวเดียวในระบบ · ประทับต่อเมื่อ customer-helper (ข้อเสนอให้ผูก
   บัญชี — ส่งเป็น quick reply หรือเป็นการ์ด customer-helper) **ไปถึงลูกค้าจริง**
   คือ LINE ตอบรับแล้วเท่านั้น ⇒ **มีค่า = ลูกค้าเห็นข้อเสนอนั้นจริง** ส่งไม่ผ่าน =
   ไม่มีค่า · เงื่อนไข "ตอนไหนถึงประทับ" แก้ได้ที่ไฟล์เดียวฝั่ง BE
   (`webhook/follow-up/customer-helper-trigger.rule.ts`) ⇒ ถ้าวันหนึ่งแถวนี้เริ่ม
   ขึ้นกับคนที่ไม่น่าจะเคยเห็นการ์ด ให้ไปดูไฟล์นั้นก่อน ไม่ใช่ที่นี่
   **ไม่มีใครลบ** — ไม่มีโค้ดสักบรรทัดในสอง repo ที่ล้างคีย์นี้ (ตั้งใจ: มันคือประวัติ)

   ── ปลายทางอีกทางของคีย์เดียวกัน ─────────────────────────────────────────
   `follow_up.customer_helper_at` เป็น **ตัวกรองผู้รับ broadcast/multicast** ด้วย
   (`omnidesk-api/.../audience/sources/audience-source.registry.ts`) ⇒ คำที่เขียนใน
   `label` ข้างล่างนี้ ต้องเป็นคำเดียวกับที่แอดมินเห็นตอนตั้งเงื่อนไขแคมเปญ
   ไม่งั้นคนคนเดียวกันจะนึกว่าเป็นคนละเงื่อนไขแล้วเลือกกลุ่มผู้รับผิด

   🔴 ทั้ง FE และตัวกรองเข้าถึงคีย์นี้ด้วย **สตริงจุด** ไม่ใช่ผ่าน constant ที่ import
      กันได้ ⇒ เปลี่ยนชื่อคีย์ฝั่ง BE เมื่อไหร่ ทั้งสองที่ **พังเงียบ** ไม่มี error
      มีแต่แถวที่หายไปกับแคมเปญที่ยิงไม่โดนใคร
      ⇒ ก่อนแตะคีย์ ต้อง grep `follow_up.line.customer_helper_trigger_at`
        **ทั้งสอง repo** ไม่ใช่ grep ชื่อค่าคงที่ */
export const CUSTOMER_HELPER_ROW = {
  key: 'customer_helper_trigger_at',
  label: 'ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน',
} as const;

/** แถวเตือนทั้งชุด — เพิ่มใบใหม่ = เติมที่นี่ที่เดียว jsx ไม่ต้องแตะ */
export const ALERT_ROWS = [
  ABANDON_ROW,
  REQUEST_REG_ROW,
  CUSTOMER_HELPER_ROW,
] as const;

export type FollowStampKey =
  | (typeof FOLLOW_ROWS)[number]['key']
  | (typeof ALERT_ROWS)[number]['key'];

/** ไม่มี stamp = แสดงคำนี้ (ชุดเดียวกับ ContactHeaderInfo ไม่ให้สองที่พูดคนละคำ) */
export const NO_STAMP = 'n/a';

/**
 * stamp ตามที่เก็บไว้จริง (ISO) หรือ null เมื่อลูกค้ายังไม่เคยถูกติดตามด้วยใบนั้น
 * รับได้ทั้ง Date และสตริง: API serialise เป็น ISO string แต่ถ้าอ่านตรงจะได้ Date
 * ⇒ ไม่ผูกกับว่าใครเป็นคนป้อนข้อมูลเข้ามา
 */
export const followStampRaw = (
  room: ChatRoom | null,
  key: FollowStampKey,
): string | null => {
  const line = (room?.user_data as any)?.config?.follow_up?.line;
  const v = line?.[key];
  if (v === undefined || v === null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * `22/08/2026 23:30` (เวลากรุงเทพ) หรือ `n/a`
 * ⚠️ ต้องส่ง timeZone ทุกครั้ง — ปล่อยว่าง = ใช้เวลาเครื่อง ซึ่งบนเซิร์ฟเวอร์/CI
 *    เป็น UTC แล้วเลขจะเพี้ยนไป 7 ชม. โดยไม่มีใครเห็น
 */
export const followStampThai = (
  room: ChatRoom | null,
  key: FollowStampKey,
): string => {
  const raw = followStampRaw(room, key);
  if (!raw) return NO_STAMP;
  return new Date(raw).toLocaleString('th-TH-u-ca-gregory', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '');
};

/** จำนวนใบที่ลูกค้าถืออยู่จริง — ใช้เป็นตัวนับบนหัวการ์ด (idiom เดียวกับ "N โน๊ต") */
export const followStampCount = (room: ChatRoom | null): number =>
  FOLLOW_ROWS.filter((r) => followStampRaw(room, r.key) !== null).length;

/* ═══════════════════════════════════════════════════════════════════════════
   [FEAT-20260825-ABANDONSTAT] "ลงทะเบียนแล้วหรือยัง" — ตัดสินจากอะไร

   🔴 คำสั่งเจ้าของ 25/08 ที่ห้ามลืม:
      *"config.follow_up.line.request_reg_at จะตรงไม่ถูก เคลียร์ไม่ว่าจุดใด
        ถ้าเช็คว่าลงทะเบียนไปแล้วหรือยัง ให้เช็คเพิ่มจาก raw profile data"*

   ทำไมถึงถูก: `request_reg_at` เป็น **RECORD ไม่ใช่ FLAG** — ไม่มีโค้ดที่ไหน
   ในระบบลบมันเลยแม้แต่บรรทัดเดียว และนั่นคือดีไซน์ (มันตอบว่า "เคยถูกขอไหม")
   ⇒ ลูกค้าที่สมัครเสร็จไปแล้วก็ยังมี stamp นี้ค้างอยู่ตลอดไป
   ⇒ **เอาไปตัดสินสถานะปัจจุบันไม่ได้เด็ดขาด** ใครเอาไปใช้แบบนั้นจะได้ผลลัพธ์ที่
     "ดูสมเหตุสมผล" แต่ผิด และไม่มี error อะไรให้จับได้เลย

   ตัวที่ตอบสถานะปัจจุบันได้จริงคือ `raw_profile_data` — มีข้อมูล = ผูกบัญชีแล้ว

   ── ⚠️ [DOC-20260825-REGSTATUS] ข้อจำกัดที่ `raw_profile_data` เองก็ยังมี ──────
   แอดมินลบโปรไฟล์ลูกค้าได้ (ปุ่มลบสำหรับ developer เท่านั้น → BE
   `chat/members.service.ts` → `clearRawProfile`) การกดครั้งนั้นทำสองอย่างพร้อมกัน
   ใน `updateOne` ก้อนเดียว: ลบ `raw_profile_data` และประทับคอลัมน์ระดับบนสุด
   `raw_profile_cleared_at`
   ⇒ ตั้งแต่วินาทีนั้น ลูกค้าที่ **สมัครไปแล้วจริง ๆ** จะทำให้ `hasRawProfile()`
     ข้างล่างคืน `false` เหมือนคนที่ไม่เคยสมัครทุกประการ ⇒ **แถวเตือนทั้งสามใบจะ
     กลับมาโผล่** แล้วแอดมินจะอ่านแล้วไปทวงลูกค้าที่ทำเสร็จไปแล้ว
     (ฝั่ง broadcast โดนรูเดียวกันเป๊ะ — ตัวบังคับ "ยังไม่ผูกข้อมูล" ของ BE ก็เช็ค
      แค่ `raw_profile_data` เหมือนกัน)

   ── ถ้าจะปิดรูนี้ฝั่ง FE: ข้อมูลมาถึงแล้ว ไม่ต้องยิง API เพิ่ม ──────────────────
   `/api/chat/contacts` ทำ `$lookup` member ทั้ง document โดยไม่ `$project`
   (ลบทิ้งแค่ `meta`) ⇒ `room.user_data.raw_profile_cleared_at` **มีมาให้อยู่แล้ว
   วันนี้** เงื่อนไขที่ถูกต้องคือ "ไม่มีโปรไฟล์ **และ** ไม่เคยถูกล้าง":

       ยังไม่เคยสมัครจริง = !hasRawProfile(room) && !user_data.raw_profile_cleared_at

   🔴 **ยังไม่ได้ทำ และไม่ควรทำฝั่งเดียว** — ป้ายบนการ์ดกับกลุ่มผู้รับของแคมเปญ
      ต้องแปลว่าอย่างเดียวกันเสมอ ถ้า FE เข้มขึ้นแต่ BE ยังเหมือนเดิม แอดมินจะเห็น
      การ์ดบอกว่า "ไม่ต้องทวงคนนี้" แต่แคมเปญยังยิงหาเขาอยู่ ซึ่งสับสนกว่าเดิม
      ⇒ ฝั่ง BE เขียนราคาและข้อถกเถียงไว้ครบแล้วที่
        `omnidesk-api/src/modules/content/audience/sources/force-no-profile.policy.ts`
        (จุดเดียวที่ต้องแก้คือ `NO_PROFILE_CLAUSE`) และ [DOC-20260825-REGSTATUS]
        PART 2 ใน `member-config.registry.ts` — **ตัดสินใจพร้อมกันสองฝั่ง**
   ⚠️ ข้อถกเถียงหลัก: ลูกค้าถูกล้างแล้วสมัครใหม่ได้ และ `raw_profile_cleared_at`
      ไม่ถูกลบตอนสมัครใหม่ ⇒ กลายเป็นประวัติเก่า · ถ้าวันหลังเขา unlink จริง ๆ
      เงื่อนไขเข้มจะซ่อนแถวเตือนของคนที่ควรถูกทวง · ไม่มีคอลัมน์ไหนตอบครบทั้งสองข้อ
   ═══════════════════════════════════════════════════════════════════════════ */

/** ลูกค้าผูกบัญชีแล้วหรือยัง — ก้อนเปล่า `{}` นับเป็น "ยัง" */
export const hasRawProfile = (room: ChatRoom | null): boolean => {
  const raw = (room?.user_data as any)?.raw_profile_data;
  if (!raw || typeof raw !== 'object') return false;
  return Object.keys(raw).length > 0;
};

/**
 * แสดงแถวเตือนไหม — ต้องครบ **สอง** เงื่อนไข
 *   1. ยังไม่ผูกบัญชี (`raw_profile_data` ว่าง)
 *   2. มีวันที่ที่เคยชวน และเป็นวันที่ที่อ่านได้จริง
 *
 * ⚠️ ปกติธง `abandon_trigger_at` ถูกเคลียร์ตอนสมัครอยู่แล้วทั้งสองเส้นทาง
 *    (เส้นแชท + เส้นลิงก์สมัคร) ⇒ เงื่อนไขที่ 1 ควรจะซ้ำซ้อน · เก็บไว้เพราะ
 *    ถ้าเส้นใดเส้นหนึ่งพลาดหรือค้าง จอจะไปกล่าวหาลูกค้าที่สมัครแล้วว่า
 *    "ยังไม่ทำ" ซึ่งแอดมินจะเชื่อและไปทวงซ้ำ · ราคาของการเช็คซ้ำถูกกว่ามาก
 */
export const showAbandonAlert = (room: ChatRoom | null): boolean =>
  !hasRawProfile(room) && followStampRaw(room, ABANDON_ROW.key) !== null;

/**
 * แถวเตือนที่ควรแสดงสำหรับห้องนี้ — ว่างเปล่าเมื่อลูกค้าผูกบัญชีแล้ว
 *
 * ⭐ เงื่อนไข "ยังไม่ผูกบัญชี" ถูกเช็ค **ครั้งเดียวข้างนอกลูป** ไม่ใช่รายแถว
 *    เพราะมันเป็นเงื่อนไขของ *ลูกค้า* ไม่ใช่ของ *แถว* · เขียนแบบนี้ทำให้เพิ่ม
 *    แถวใหม่แล้วลืมใส่เงื่อนไขไม่ได้เลย ซึ่งเป็นความผิดพลาดที่ป้ายพวกนี้ทนไม่ได้
 */
export const alertRowsFor = (
  room: ChatRoom | null,
): ReadonlyArray<{ readonly key: FollowStampKey; readonly label: string }> => {
  if (hasRawProfile(room)) return [];
  return ALERT_ROWS.filter((r) => followStampRaw(room, r.key) !== null);
};

/**
 * [UI-20260825-COLPEEK] ชื่อคอลัมน์จริงในฐานข้อมูลของแถวนั้น
 *
 * WHY: เจ้าของขอปุ่มรูปตาในการ์ด กดแล้วเห็นว่าป้ายภาษาไทยแต่ละอันมาจากคอลัมน์ไหน
 *      *"เผื่องง"* — เวลาไปตั้งเงื่อนไข broadcast หรือคิวรี่ฐานจะได้ไม่เดา
 * ⚠️ คืน **dotted path เต็ม** ไม่ใช่แค่ชื่อ leaf เพราะนั่นคือสิ่งที่เอาไป
 *    `db.members.find({...})` ได้จริงทันที · leaf เปล่า ๆ ใช้คิวรี่ไม่ได้
 */
export const columnPath = (key: FollowStampKey): string =>
  `config.follow_up.line.${key}`;
