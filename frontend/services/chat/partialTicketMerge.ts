/* ==== [PERF-20260822-TKTIDSFETCH] รวมแถวที่ดึงมาบางส่วน เข้ากับลิสต์ที่ถืออยู่ ====
 *
 * ## ทำไมต้องมีไฟล์นี้
 * event ที่ patch ในที่ไม่ได้ (ตั๋วใหม่ หรือ event ของแถวที่ยังไม่มีในลิสต์) เดิม
 * ตกไป `scheduleRefetch()` ซึ่งโหลด **ทั้งลิสต์** ด้วย `limit=all` — ตั๋วใหม่ใบเดียว
 * = โหลดใหม่หมด ตอนนี้ดึงเฉพาะใบที่ต้องการผ่าน `ids` แล้วเอามารวมที่นี่
 *
 * ## ทำไมเป็นฟังก์ชันบริสุทธิ์ ไม่ฝังใน component
 * มันเป็นตรรกะที่ผิดแล้ว **badge เพี้ยนเงียบ ๆ** (นับซ้ำ / นับขาด) — ต้องเทสได้ตรง ๆ
 * ไม่ใช่ผ่าน DOM · แพทเทิร์นเดียวกับ `memberSearchText.ts` / `memberTier.ts`
 *
 * ## กฎที่ห้ามผิด
 * 1. **ห้ามซ้ำ** — badge นับจากจำนวนแถวใน array (`TicketChat.tsx:1966`)
 *    แถวซ้ำ 1 แถว = badge เกิน 1
 * 2. **ต้องกรองสิทธิ์ซ้ำ** — `fetchActive` กรอง `userAllowedHooksSet` ฝั่ง client
 *    ก่อน `setActiveTickets` ทางนี้ต้องกรองเหมือนกัน ไม่งั้นแถวที่แอดมินไม่มีสิทธิ์
 *    จะเข้ามาทางลัดนี้
 * 3. **ไม่ต้องเรียง** — จอเรียงเองที่ `visibleTicketsPinned` (`TicketChat.tsx:1788`)
 *    ด้วย `activityAt` + pinned-first ⇒ ลำดับใน array ไม่มีผลต่อการแสดงผล
 *    (ตรวจแล้วว่าไม่มีที่ไหนพึ่ง `activeTickets[0]`)
 * 4. **ไม่มีอะไรเปลี่ยน = คืน array เดิม** (อ้างอิงเดิม) เพื่อไม่ให้ React
 *    re-render ทั้งลิสต์เปล่า ๆ
 *
 * ## ที่ตั้งใจไม่ทำ
 * - ไม่ลบแถวที่ BE ไม่ส่งกลับมา: คำขอนี้ถูกกรองด้วย `job_status`/`search`/`within_days`
 *   เหมือนลิสต์เต็ม ⇒ "ไม่ส่งกลับ" แปลว่า "ไม่เข้าเงื่อนไข" ไม่ใช่ "ถูกลบ"
 *   การลบแถวเป็นหน้าที่ของ `ticket:updated` (patch) กับ full refetch เท่านั้น
 *
 * revert: ลบไฟล์นี้ แล้วคืน `scheduleRefetch()` ที่จุดเรียกใน TicketChat
 */

/**
 * เพดานจำนวน id ต่อคำขอหนึ่งครั้ง
 *
 * ⚠️ ต้องตรงกับ `TICKET_IDS_MAX` ใน `omnidesk-api/src/modules/tickets/list-ids.util.ts`
 * import ข้าม repo ไม่ได้ จึงผูกกันด้วยคอมเมนต์นี้ — แก้ฝั่งไหนต้องแก้อีกฝั่งด้วย
 * ถ้า FE ส่งเกิน BE จะตัดทิ้งเงียบ ๆ แถวส่วนเกินจะไม่ถูก merge (แล้วรอ full refetch
 * ครั้งถัดไปมากู้) — ฝั่งเรียกจึงเลือกโหลดเต็มไปเลยเมื่อเกิน ถูกกว่ายิงหลายรอบ
 */
export const PARTIAL_FETCH_MAX_IDS = 50;

/** เท่าที่ตรรกะนี้ต้องรู้ — ไม่ผูกกับรูปเต็มของ ticket */
export interface MergeableTicket {
  _id: string;
  line_oa_hook_id?: string | null;
}

export interface MergeOptions {
  /** สิทธิ์ของแอดมิน — `null`/`undefined` = ไม่จำกัด (เหมือน fetchActive) */
  allowedHooks?: Set<string> | null;
}

/**
 * แถวที่แอดมินคนนี้เห็นได้ไหม — กติกาเดียวกับ `fetchActive` เป๊ะ
 * (`!tk.line_oa_hook_id || allowed.has(String(tk.line_oa_hook_id))`)
 */
export function isTicketVisible<T extends MergeableTicket>(
  tk: T,
  allowedHooks?: Set<string> | null,
): boolean {
  if (!allowedHooks) return true;
  return !tk.line_oa_hook_id || allowedHooks.has(String(tk.line_oa_hook_id));
}

/**
 * รวม `incoming` เข้ากับ `prev`
 *
 * - `_id` ที่มีอยู่แล้ว → **แทนที่ด้วยของใหม่** (BE เป็นความจริงล่าสุด)
 * - `_id` ใหม่ → ต่อท้าย (ลำดับไม่สำคัญ ดูกฎข้อ 3)
 * - แถวที่ไม่มีสิทธิ์ → ทิ้ง
 * - `incoming` ซ้ำกันเอง → เอาใบหลังสุด
 */
export function mergePartialTickets<T extends MergeableTicket>(
  prev: T[],
  incoming: T[],
  options: MergeOptions = {},
): T[] {
  const allowed = options.allowedHooks ?? null;

  // ยุบ incoming ที่ซ้ำกันเองก่อน แล้วค่อยกรองสิทธิ์
  const byId = new Map<string, T>();
  for (const tk of incoming) {
    if (!tk || !tk._id) continue;
    if (!isTicketVisible(tk, allowed)) continue;
    byId.set(String(tk._id), tk);
  }
  if (byId.size === 0) return prev;

  let changed = false;
  const out = prev.map((tk) => {
    const fresh = byId.get(String(tk._id));
    if (!fresh) return tk;
    byId.delete(String(tk._id));
    if (fresh !== tk) changed = true;
    return fresh;
  });

  if (byId.size > 0) {
    out.push(...byId.values());
    changed = true;
  }
  return changed ? out : prev;
}
