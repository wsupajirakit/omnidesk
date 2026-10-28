/**
 * [REFACTOR-20261027-TCSPLIT] TicketChat's module-level constants, moved out of
 * `pages/chat/TicketChat.tsx` verbatim — only `export` was added. Read by the page and by
 * the pieces it was split into (this folder). Values unchanged byte-for-byte.
 * revert: paste these declarations back above `export const TicketChat` and drop the import.
 */
// ── Category options — the customer provider's set when it declares one
//    ([FEAT-20261014-TICKETCATS], loan_v1); otherwise these sets, driven by the
//    acme_category flag exactly as before (shop-api) ──────────────────────────
// Mirrors TicketSupport so the two pages classify tickets identically.
export type CategoryOption = { label: string; match: (cat?: string | null) => boolean };
// Legacy 4-category dropdown + match rules — copied verbatim from the ticket
// page's filter on branch main (TicketSupport filterCategory switch), so the
// two pages classify identically:
//   ทวงถาม   = Collection / ค่างวด / ทวงถาม
//   อุปกรณ์   = IT / อุปกรณ์
//   ชำระค่างวด = Payment / รับยอด
//   อื่นๆ     = Other / อื่นๆ / (no category)  [Loan/สินเชื่อ falls here in the dropdown]
// Matching is case-insensitive (payment/Payment/PAYMENT, it/IT, …). `lc`
// lowercases the English keys; Thai keys compare as-is.
const lc = (c?: string | null) => (c || '').trim().toLowerCase();
/* [FEAT-20261022-I18NTICKETEN] display key per category label — the Thai label stays the filter VALUE */
export const CATEGORY_LABEL_KEY: Record<string, string> = {
  'ทวงถาม': 'ticketui.category.collection',
  'อุปกรณ์': 'ticketui.category.device',
  'ชำระค่างวด': 'ticketui.category.payment',
  'อื่นๆ': 'ticketui.category.other',
  'แจ้งฝาก': 'ticketui.category.deposit',
};
/* [FEAT-20261022-I18NTICKETEN] history-modal customer rows: Thai label = row id, shown through t */
export const ROW_LABEL_KEY: Record<string, string> = {
  'เบอร์โทร': 'ticketui.history.row.phone',
  'ชื่อ LINE': 'ticketui.history.row.line_name',
  'ชื่อเล่น': 'ticketui.history.row.nickname',
  'ชื่อ-สกุล': 'ticketui.history.row.full_name',
  'รหัสสัญญา': 'ticketui.history.row.contract',
  'ลงทะเบียนโดย': 'ticketui.history.row.registered_by',
  'โดเมน': 'ticketui.history.row.domain',
  'สายงาน': 'ticketui.history.row.agent',
  'ธนาคาร': 'ticketui.history.row.bank',
  'เลขบัญชี': 'ticketui.history.row.account_no',
  'ชื่อบัญชี': 'ticketui.history.row.account_name',
  'ทรูวอเล็ต': 'ticketui.history.row.true_wallet',
};
export const CATEGORIES_LEGACY: CategoryOption[] = [
  { label: 'ทวงถาม', match: (c) => lc(c) === 'collection' || c === 'ค่างวด' || c === 'ทวงถาม' },
  { label: 'อุปกรณ์', match: (c) => lc(c) === 'it' || c === 'อุปกรณ์' },
  { label: 'ชำระค่างวด', match: (c) => lc(c) === 'payment' || c === 'รับยอด' },
  { label: 'อื่นๆ', match: (c) => lc(c) === 'other' || c === 'อื่นๆ' || !c },
];
export const CATEGORIES_NARROW: CategoryOption[] = [
  { label: 'แจ้งฝาก', match: (c) => lc(c) === 'payment' || c === 'รับยอด' || c === 'แจ้งฝาก' },
  { label: 'อื่นๆ', match: (c) => lc(c) !== 'payment' && c !== 'รับยอด' && c !== 'แจ้งฝาก' },
];

// Status tabs map to job_status: waiting=0, active=1, ended=2. `bot` is a view
// over active tickets whose chat is still bot-controlled (assist off).
export type StatusTab = 'mine' | 'waiting' | 'active' | 'ended' | 'bot';
export const STATUS_TABS: { key: StatusTab; label: string; jobStatus?: number }[] = [
  { key: 'mine', label: 'ส่วนตัว', jobStatus: 1 },
  { key: 'waiting', label: 'รอรับเคส', jobStatus: 0 },
  { key: 'active', label: 'กำลังคุย', jobStatus: 1 },
  { key: 'ended', label: 'ปิดเคส', jobStatus: 2 },
  { key: 'bot', label: 'บอทดูแล' },
];

// [FEAT-20260808-DATESCOPE] date-scope options for the ⚙️ popover. value = the
// string kept in state; '' = ทั้งหมด (param OMITTED → identical to today).
// Order: default (2 วัน) first, ทั้งหมด last (the escape hatch to today's behavior).
/* [FEAT-20260810-DATESCOPE] เหลือ 2/5/7/ทั้งหมด (เจ้าของสั่ง 2026-08-10)
   เดิมมี 3 กับ 4 ด้วย — ตัดออกเพราะถี่เกินไป เลือกยากและไม่ค่อยได้ใช้
   ⚠️ ค่าที่ถูกตัด ('3','4') ยังใช้ได้ถ้ามีคนเคยเลือกค้างไว้ — `dateScopeLabel`
      ตกเป็น '2 วัน' และตัวกรองยังคำนวณจากตัวเลขนั้นตามปกติ ไม่พัง
   revert: ใส่ 2 บรรทัดที่ตัดออกกลับมา */
/* [FIX-20260902-DATESCOPE2] Owner, 02/09: TWO choices only — 7 วัน and ทั้งหมด.
   `2` and `5` were dropped for the same reason `3` and `4` went on 10/08: a list
   of near-identical windows is harder to choose from than it is useful.

   ⚠️ A VALUE NO LONGER OFFERED MUST STILL WORK. `filterWithinDays` lives in
      component state, so an operator can be holding `'2'` or `'5'` from before
      this change. The filter reads the NUMBER, not this list, so those keep
      narrowing correctly — only the label has to cope, and `dateScopeLabel`
      below now derives it instead of guessing.
   ⚠️ `''` IS NOT "zero days" — it means the parameter is OMITTED, so the server
      applies no bound at all. That is the escape hatch back to today's
      behaviour and must stay last.
   revert: paste the removed rows back. */
export const DATE_SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: '7', label: '7 วัน' },
  { value: '', label: 'ทั้งหมด' },
];

/* [FEAT-20260819-SHOWALL] The ⚙️ date-scope picker (2/5/7 วัน · ทั้งหมด) is hidden
   because the page now shows everything and only draws 25 cards at a time. Kept
   in the tree behind this flag rather than deleted — the owner asked for it back
   one day, and a deleted popover with its state, its outside-click handler and
   its option list is a rewrite, not a revert.
   เปิดกลับมาใช้: เปลี่ยนเป็น true ค่าเดียว. */
/* [FIX-20260902-DATESCOPE2] Back on, exactly as this comment said it would be:
   one value, no rewrite. The owner asked for the control again on 02/09.

   It is not cosmetic here. `withinDaysParam` is the single input BOTH halves of
   the บอทดูแล badge filter by — the rows (`botRows`) and the server's room count
   — and it therefore decides how many pages `listAllRooms` has to fetch. On
   `7 วัน` that is normally one; only `ทั้งหมด` pays for every room. Shipping the
   paging without this control would have left the most expensive setting as the
   only possible one. */
export const SHOW_DATE_SCOPE = true;

/** [FEAT-2708-SEARCHMIN4] ขั้นต่ำตัวอักษรก่อน search (ticket) จะทำงาน */
export const TICKET_SEARCH_MIN_CHARS = 4;
