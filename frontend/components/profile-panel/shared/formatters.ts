/**
 * [REFACTOR-20260905-CUSTPROV] Value formatters shared by 2+ moved card
 * files: `xpAmt` (money, 2dp with thousands separators), `xpDT` (short Thai
 * datetime for history rows), `xpStatusTH` (row status → Thai label).
 *
 * WHY THESE THREE AND NOT THE OTHERS: `dev-local §6` moves a helper to
 * `shared/` only when 2+ card files need it.
 *   xpAmt       → โปรโมชั่น, สินค้าที่ซื้อล่าสุด, การเงิน, โบนัส
 *   xpDT        → สินค้าที่ซื้อล่าสุด, การเงิน, โบนัส, กิจกรรม
 *   xpStatusTH  → การเงิน, โบนัส
 * `xpDTFull`, `xpProductLabel`, `xpActivityTone` and `XP_PRODUCT_COLORS` are each used
 * by exactly ONE card and were left in `ProfilePanel.tsx` (now exported) for
 * that one card to import, per the same rule.
 *
 * MOVED VERBATIM — no formatting rule, rounding, or edge case changed, only
 * the file these functions live in.
 *
 * revert: paste `xpAmt` / `xpDT` / `xpStatusTH` back into `ProfilePanel.tsx`
 * (they sat with the other `xp*` formatters near the top of the file, right
 * after the type/import block), delete this file, and change every
 * `from '../shared/formatters'` / `from './shared/formatters'` import back
 * to a plain in-file reference.
 */
import { translateNow } from '../../../i18n';
export const xpAmt = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'; };
export const xpDT = (iso: any) => {
  if (!iso) return '-';
  // [FEAT-20260801-SHOPAPIV1SHAPE] Shop-API ตัวจริงส่งเวลามาเป็น "ตัวเลข" 2 หน่วยปนกัน
  // ในก้อนเดียว: transactions[].date = epoch **มิลลิวินาที** (1784629980605)
  // แต่ balances[].updated_at = epoch **วินาที** (1784629980)
  // new Date(number) ตีความเป็น ms เสมอ → ค่าที่เป็นวินาทีจะกลายเป็นปี 1970
  // แยกด้วยขนาด: epoch วินาทีของยุคนี้ ~1.7e9 ส่วน ms ~1.7e12 → เกณฑ์ 1e12 ปลอดภัย
  // (ของเดิมที่ส่ง ISO string เข้ามาไม่เข้าเงื่อนไขนี้เลย จึงไม่กระทบ)
  let v: any = iso;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) {
    const n = Number(v);
    v = n < 1e12 ? n * 1000 : n;
  }
  const d = new Date(v);
  if (isNaN(+d)) return String(iso);
  /* [FEAT-20261022-I18NTICKETEN] the date speaks the UI language: th-TH + "น." in Thai,
     en-GB with no suffix in English (locale and pattern live in the dictionary). */
  const d2 = d.toLocaleString(translateNow('ticketui.panel.date_locale', 'th-TH'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return translateNow('ticketui.panel.datetime_fmt', '{d}น.').replace('{d}', d2);
};
// [FEAT-20260801-SHOPAPIV1FIELDS] แปลง status ของแถวเป็นข้อความไทย
// คืน '' เมื่อ "จบแล้วปกติ" หรือไม่มี status → จอเดิม (mock) ไม่เปลี่ยนสักจุด
export const xpStatusTH = (s: any) => {
  const v = String(s ?? '').toLowerCase();
  if (!v || v === 'success' || v === 'done' || v === 'completed' || v === 'approved') return '';
  if (v === 'cancel' || v === 'canceled' || v === 'cancelled') return translateNow('common.cancel', 'ยกเลิก');
  if (v === 'reject' || v === 'rejected' || v === 'failed' || v === 'fail') return translateNow('ticketui.panel.status_failed', 'ไม่สำเร็จ');
  return translateNow('status.pending', 'รอดำเนินการ');
};

/* [FEAT-20261022-I18NTICKETEN] Is the UI in Thai? Read from the dictionary's own locale tag
   (`ticketui.panel.date_locale`), for the few places that must pick a whole strategy rather
   than one string — e.g. the site-rules labels come from the editable Thai dictionary in
   Thai, and from the raw field name in any other language. */
export const uiIsThai = (): boolean => translateNow('ticketui.panel.date_locale', 'th-TH').startsWith('th');
