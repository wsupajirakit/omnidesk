/**
 * [FIX-20260820-DIVIDEROWNER] Has this case's line already been written?
 * ============================================================================
 * Owner, 2026-08-20, after one case drew two orange lines and the first fix was
 * made here: "เอาวิธีที่ดีที่สุด · abandon ต้องไม่เบิ้ล · ไม่มาแก้ไขปลายเหตุ ·
 * ทุกอย่างต้องปกติ พวก slip ปกติ seamless ห้ามกระทบ".
 *
 * THE ROOT CAUSE IS NOT HERE, AND THIS FILE NO LONGER PRETENDS OTHERWISE.
 * `ticket.direct_ticket` was carrying two meanings at once:
 *   1. "the system opened this case"           → the orange badge on the avatar
 *   2. "nobody wrote the line, please draw it" → the synthetic divider below
 * Meaning 2 was true in 2026-08-10, when no path wrote a real row. It stopped
 * being true when the backend's case-opener started writing one — but the flag
 * still said it, so the transcript drew the line a second time.
 *
 * The backend now states fact 2 itself: `writeTicketDivider` stamps the row it
 * writes with the case it wrote it for (`metadata.ticket_id`). This function just
 * reads that stamp. No name matching, no time window, no inference.
 * คนเขียนแถวบอกเองว่าแถวนี้ของเคสไหน · ที่นี่แค่อ่าน ไม่เดา.
 *
 * ⚠️ WHAT THIS REPLACED, and why the earlier attempt was not good enough.
 * `systemCaseDivider.ts` suppressed the synthetic whenever the room held any
 * `direct_ticket` row carrying `actor_name`. That matched today's data — all
 * twenty slip rows lacked the key, all four system rows had it — but it could not
 * tell one case from another, so a slip case in a room that had ever seen a
 * system case would have lost its only line. It also went blank when the row
 * write failed silently, and `claimRoomAndOpenCase` opening a case on every
 * level-2 message was about to make both far more likely. That file is deleted.
 *
 * ⚠️ SEAMLESS BY CONSTRUCTION — an unstamped row means "keep drawing":
 *   slip → case opened   writes no row at all   → nothing stamped → drawn, as today
 *   slip → room claimed  writes no ticket       → untouched
 *   every row in the DB before this shipped     → drawn, exactly as today
 *   the row write failed (it returns null and
 *   swallows the error)                         → drawn — the line is not lost
 *   a room holding both kinds of case           → each reads its own stamp only
 * แถวที่ไม่มีป้าย = วาดต่อเหมือนเดิม ⇒ ของเก่าและสลิปไม่ขยับเลย.
 *
 * revert: delete this file and the guard in `ChatRoomView.tsx`; a system-opened
 * case draws two lines again.
 */

/** The variant both writers share. Must stay in step with `DIVIDER_STYLES`. */
const DIRECT_TICKET_VARIANT = 'direct_ticket';

/** Only the fields that decide it, so the raw stream can be passed as-is. */
interface DividerLike {
  message_type?: unknown;
  metadata?: { variant?: unknown; ticket_id?: unknown } | null;
}

/**
 * True when the transcript already carries the divider written FOR THIS CASE —
 * in which case the synthetic must stand down.
 *
 * False whenever anything is unknown: no case id, no stream, no stamp. Drawing a
 * line that is already there is a cosmetic bug; dropping the only record that a
 * case was opened is a hole in the transcript, so the doubt resolves towards
 * drawing. ไม่แน่ใจ = วาดไว้ก่อน.
 */
export function caseDividerAlreadyWritten(
  messages: unknown,
  ticketId: unknown,
): boolean {
  const id = String(ticketId ?? '').trim();
  if (!id || !Array.isArray(messages)) return false;
  return messages.some((row: unknown) => {
    const m = row as DividerLike | null | undefined;
    if (!m || m.message_type !== 'divider') return false;
    const meta = m.metadata;
    if (!meta || meta.variant !== DIRECT_TICKET_VARIANT) return false;
    return String(meta.ticket_id ?? '').trim() === id;
  });
}

/* ── [FIX-20260825-NOSYSLINEONREOPEN] เคสที่ "คนกดเปิด" ต้องไม่มีป้ายว่าระบบสร้าง
 * ===========================================================================
 * เจ้าของ 25/08: *"ห้องที่ปิดเคสแล้ว / กดเปิดเคส divider ส้ม (ตัวเดิม) มาเลื่อนตาม"*
 * แล้วสรุปเป็นกติกาว่า *"มันก็ไม่ควรจะมีไง เวลาเปิดเคส (ที่ถูกปิด)"*
 *
 * 🔴 ทำไมป้ายถึง "เลื่อน": ป้ายส้มไม่ใช่แถวในฐานข้อมูล มันถูก**สังเคราะห์ตอน
 *    render** จาก `ticketMeta` ใบปัจจุบัน แล้ววางที่ `ticketMeta.created_at`
 *    ⇒ โดยธรรมชาติมันมีได้ทีละใบ และย้ายไปอยู่กับเคสล่าสุดเสมอ · ปิดเคสแล้วกด
 *    เปิดใหม่ = ตั๋วใบใหม่ = ป้ายย้ายมาอยู่ตรงเวลาที่เพิ่งกด ทั้งที่คนเป็นคนเปิด
 *
 * 🔴 ทำไมถามจาก "บทสนทนา" ไม่ใช่จากธง `direct_ticket`: ธงนั้นบอกที่มาของ
 *    **แคมเปญ** ไม่ได้บอกว่าใครกดเปิดเคสใบนี้ · ส่วน BE เขียน divider ของทุกเส้น
 *    ผ่าน `writeTicketDivider` ตัวเดียวกันและ stamp `ticket_id` ลงไปเสมอ
 *    (`ticket-divider.helper.ts:190`) ⇒ บทสนทนา**บันทึกไว้แล้ว**ว่าเคสใบนี้ใครเปิด
 *    นี่จึงเป็นการเปิดดู ไม่ใช่การเดา
 *
 * ⚠️ เทียบด้วย `ticket_id` ของเคสใบนั้น **ไม่ใช่** ถามว่า "ห้องนี้เคยมีไหม" —
 *    เวอร์ชันก่อนหน้าเคยถามแบบหลังแล้วพัง เคสสลิปที่อยู่ห้องเดียวกับเคส abandon
 *    หายป้ายไปทั้งเส้น (ดูเคส "a room holding BOTH kinds" ใน
 *    `caseDividerWritten.value.test.ts`) · ผูกกับใบ = ต่างคนต่างอ่านป้ายของตัวเอง
 * ⚠️ แถวเก่าที่ไม่มี `ticket_id` อ่านว่า "ไม่ตรง" ⇒ พฤติกรรมเดิมทุกประการ
 */

/** variant ที่แปลว่า **คน**เป็นคนเปิดเคสใบนี้ ไม่ใช่ระบบ */
const ADMIN_OPEN_VARIANTS = ['reopen_by_admin', 'open_by_admin'];

export function caseOpenedByAdmin(
  messages: unknown,
  ticketId: unknown,
): boolean {
  const id = String(ticketId ?? '').trim();
  if (!id || !Array.isArray(messages)) return false;
  return messages.some((row: unknown) => {
    const m = row as DividerLike | null | undefined;
    if (!m || m.message_type !== 'divider') return false;
    const meta = m.metadata;
    if (!meta || typeof meta.variant !== 'string') return false;
    if (!ADMIN_OPEN_VARIANTS.includes(meta.variant)) return false;
    return String(meta.ticket_id ?? '').trim() === id;
  });
}
