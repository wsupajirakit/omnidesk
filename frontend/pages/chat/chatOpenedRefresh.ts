/**
 * [FEAT-20260825-CHATOPENFRESH] คลิกการ์ดแชท = ดึงข้อมูลลูกค้าสดทันที
 * ===========================================================================
 * โจทย์เจ้าของ 25/08: *แค่คลิกการ์ด (ไม่ต้องเปิดเคส ไม่ต้องรับเคส) ก็ต้อง fetch สด
 * + บันทึกลง record ของ member คนนั้นด้วยข้อมูลล่าสุด + panel ขวาต้องได้ของล่าสุด
 * Both raw profile and site rules are refreshed by the member refresh (A).
 *
 * ⭐ ไฟล์นี้ไม่ได้ "ดึงข้อมูล" เอง และตั้งใจให้เป็นแบบนั้น
 *    ท่อดึงสดมีครบอยู่แล้วทั้งเส้น ไม่ได้สร้างอะไรใหม่เลยสักท่อ:
 *      TicketChat.doOpenTicket
 *        → dispatch 'tc:customer-profile-updated' (ช่องทางเดิมของระบบ)
 *          → PersonalPanel ฟังอยู่แล้ว → ticketService.refreshRawProfile(.., 'chat_opened')
 *            → BE members.service checks trigger → bypasses cooldown → writes
 *              raw_profile_data and raw_site_rules_data from the same combined response.
 *
 * IMPORTANT: do not add an automatic site-rules refresh (B) to this event.
 * A already fetches CUSTOMER_PROFILE and SITE_RULES with the real LINE user id.
 * B calls getCombinedData('') for an OA-level refresh; it fans out to
 * CUSTOMER_PROFILE too, producing line_user_id= and a deterministic upstream 400,
 * while also fetching SITE_RULES twice. The explicit Site Rules Refresh button
 * remains intentionally separate and continues to use refreshHookSiteRules.
 *    สิ่งเดียวที่ไฟล์นี้ถือคือ **ชื่อ action** ซึ่งต้องตรงกัน 3 ที่
 *    (ตัวยิง · ตัวฟัง · trigger ที่ส่งไป BE) — พิมพ์ผิดที่ใดที่หนึ่ง = เงียบสนิท
 *    ไม่มี error ให้เห็น ซึ่งเป็นโหมดพังที่ repo นี้โดนมาแล้วหลายรอบ
 *
 * ⚠️ ทำไมไม่กันยิงซ้ำแบบ caseTakenRefresh.ts
 *    `shouldFireCaseTaken` ต้องกันเพราะมันอยู่ใน useEffect ที่รันทุก re-render
 *    อันนี้ถูกเรียกจาก `doOpenTicket` ซึ่งรัน **หนึ่งครั้งต่อการคลิกหนึ่งครั้ง**
 *    ⇒ "คลิก 1 = ยิง 1" อยู่แล้วโดยโครงสร้าง ไม่ต้องมีตัวจำสถานะ
 *    เจ้าของสั่งชัดว่า *ทะลุ cooldown ทุกครั้งที่เปิด* ⇒ จงใจไม่ dedup ซ้ำคนเดิม
 *
 * revert: ลบไฟล์นี้ + จุดเรียกใน pages/chat/TicketChat.tsx (marker เดียวกัน)
 *         + เอา 'chat_opened' ออกจาก PersonalPanel.tsx และ ticketService.ts
 */

/** ชื่อ event เดิมของระบบ — ไม่ได้สร้างช่องทางใหม่ */
export const PROFILE_EVENT = 'tc:customer-profile-updated';

/** ชื่อ action — แหล่งความจริงเดียว ห้ามพิมพ์สตริงนี้ซ้ำที่อื่น */
export const CHAT_OPENED_ACTION = 'chat_opened';

export interface ChatOpenedDetail {
  readonly channel_user_id: string;
  readonly action: typeof CHAT_OPENED_ACTION;
}

/**
 * ประกอบ payload ของ event — คืน `null` เมื่อไม่มี LINE user id
 *
 * ⚠️ `null` สำคัญกว่าที่เห็น: ยิง event ที่ `channel_user_id` เป็น undefined
 *    ตัวฟังจะเทียบกับห้องที่เปิดอยู่ไม่ตรง แล้วเงียบไปเฉย ๆ — อาการจะเหมือน
 *    "ฟีเจอร์ไม่ทำงาน" ทั้งที่ยิงแล้ว · กันตั้งแต่ต้นทางชัดกว่า
 */
export const chatOpenedDetail = (
  lineUserId: string | null | undefined,
): ChatOpenedDetail | null => {
  const id = typeof lineUserId === 'string' ? lineUserId.trim() : '';
  if (!id) return null;
  return { channel_user_id: id, action: CHAT_OPENED_ACTION };
};

/* ═══════════════════════════════════════════════════════════════════════════
   การตัดสินใจว่า action ไหนทำอะไร — ย้ายออกมาจาก PersonalPanel เมื่อ 25/08

   ⚠️ ทำไมต้องย้าย (บทเรียนจริง ไม่ใช่ความสวยงาม): ตอนแรกเขียนเป็น `if` ฝังใน
   คอมโพเนนต์ 5,400 บรรทัด แล้วเทสไปปักด้วย "ไฟล์นี้มีสตริง 'chat_opened' ไหม"
   ⇒ ตอนลองลบโค้ดจริงออก (mutation M3/M4) **เทสยังเขียว** เพราะสตริงเดียวกัน
   ไปโผล่ที่บล็อกข้าง ๆ · เทสแบบนั้นวัดไม่ได้เลย
   ⇒ ตรรกะย้ายมาที่นี่เพื่อให้เทส "พฤติกรรม" ได้ตรง ๆ และ PersonalPanel เหลือ
     หน้าที่เดียวคือเรียกใช้ · ปักด้วยชื่อฟังก์ชันซึ่งมีที่เดียวในทั้ง repo
   ═══════════════════════════════════════════════════════════════════════════ */

/** trigger ที่จะส่งไป BE — `undefined` = ไม่ส่ง (ยังติด cooldown ตามเดิม) */
export type UpstreamTrigger = 'case_taken' | typeof CHAT_OPENED_ACTION;

export interface ProfileRefreshPlan {
  /** ต้องสั่ง BE ไปถามปลายทางใหม่ไหม */
  readonly upstream: boolean;
  /** เหตุผลที่ขอข้าม cooldown — ไม่มี = ไม่ขอข้าม */
  readonly trigger?: UpstreamTrigger;
}

const NO_REFRESH: ProfileRefreshPlan = { upstream: false };

/**
 * action → จะดึง raw profile ใหม่ไหม และขอข้าม cooldown ด้วยเหตุผลอะไร
 *
 * ⚠️ `manual_refresh` **ต้อง** ได้ `trigger: undefined` ตลอดไป — ปุ่ม refresh มือ
 *    ถูกสั่งไว้ตั้งแต่ตอนทำ throttle ว่าต้องติด cooldown 10 วิเหมือนเดิม
 *    ถ้าวันไหนมันข้าม cooldown ได้ = เบรกกดรัวตายทั้งระบบโดยไม่มีใครรู้
 * ⚠️ action ที่ไม่รู้จัก → ไม่ดึง (push จาก BE ก็มาทาง event นี้ และของใน DB
 *    สดอยู่แล้ว ไม่ต้องยิงปลายทางซ้ำ)
 */
export const profileRefreshPlan = (action: unknown): ProfileRefreshPlan => {
  if (action === 'manual_refresh') return { upstream: true };
  if (action === 'case_taken') return { upstream: true, trigger: 'case_taken' };
  if (action === CHAT_OPENED_ACTION) {
    return { upstream: true, trigger: CHAT_OPENED_ACTION };
  }
  return NO_REFRESH;
};
