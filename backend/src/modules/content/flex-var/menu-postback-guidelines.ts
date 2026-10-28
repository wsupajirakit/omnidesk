/**
 * ==== [FEAT-20260829-MENUPBGUIDE] the postback spec an operator can COPY ====
 *
 * Owner, 29/08: "ก็ไม่ให้พิมพ์เองแต่ให้ copy — fe โหลด single truth ที่ be มีบอก
 * แล้วแสดงให้ copy" and "be ออกให้จุดเดียว".
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * A menu button carries a postback payload, and until now an operator had to
 * TYPE it into the flex editor by hand. Every near-miss fails SILENTLY —
 * measured 29/08 against the real parser:
 *
 *     menu:v1:open:sub-a   ✓ opens the card
 *     menu:open:sub-a      ✗ silent   (forgot the version)
 *     menu:v1:opne:sub-a   ✗ silent   (typo)
 *     menu:v1:open:Sub-A   ✗ silent   (uppercase — the charset is lowercase)
 *     menu:v1:open:sub a   ✗ silent   (a space)
 *     menu:v1:sub-a        ✗ silent   (forgot `open`)
 *
 * "Silent" means the customer taps and NOTHING happens: no error, no log, no
 * clue for the admin until somebody complains. A copyable spec removes the
 * typing, and with it the whole failure class.
 *
 * ── WHY IT IMPORTS `@/modules/menu` ─────────────────────────────────────────
 * Every string below is BUILT BY THE CODEC, never hand-written. That is the
 * entire point: a hand-typed copy in this file would be a SECOND spelling of
 * the grammar, and the day the codec changes it would keep handing operators a
 * payload that silently no longer parses — the exact failure it exists to
 * prevent. One derivation cannot drift; a copy always does.
 *
 * This is the module's single sanctioned importer, listed by name in
 * `menu-isolation-census.spec.ts` (ALLOWED_IMPORTERS) so the exception is
 * reviewable rather than a quietly weakened rule. It imports only the two pure
 * minters — no engine, no renderer, no DB.
 *
 * revert: delete this file, its call site in flex-messages.service.ts, and the
 *         ALLOWED_IMPORTERS entry. The guide table loses these rows; nothing
 *         else changes, because no code path reads them.
 */
import {
  buildMenuOpenPostback,
  buildMenuPostback,
  MENU_POSTBACK_MAX_BYTES,
} from '@/modules/menu';
import type { GuidelineRow } from './flex-var-guidelines';

/**
 * Sample values used ONLY to render an illustrative payload. They are not a
 * naming rule: a slug is whatever the operator typed in `flex_slug`, and the
 * collection already holds `1234` next to `menu-seed-primary-a`.
 */
const SAMPLE_SLUG = 'sub-a';
const SAMPLE_SCENARIO = 'second';
const SAMPLE_ITEM = 'item-1';

/**
 * The rows the dashboard shows for a `menu` card.
 *
 * ⚠️ These are POSTBACK payloads, not `{{variables}}`. They go in a button's
 * `action.data`, which is why `noPrefix` is set — the guide table must not wrap
 * them in braces the way it does a variable tag.
 */
export function buildMenuPostbackGuidelines(): GuidelineRow[] {
  return [
    {
      tag: buildMenuOpenPostback(SAMPLE_SLUG),
      desc: `เปิดการ์ดเมนูอีกใบ — เปลี่ยน "${SAMPLE_SLUG}" เป็น Menu Slug ของการ์ดปลายทาง (แก้ทีหลังได้ ไม่ต้อง deploy)`,
      source: 'action.data ของปุ่ม (postback)',
      example: buildMenuOpenPostback('sub-x'),
      noPrefix: true,
    },
    {
      tag: buildMenuPostback(SAMPLE_SCENARIO, SAMPLE_ITEM),
      desc: `เรียกเมนูที่ตั้งไว้ในระบบ — รูปแบบ <scenario>:<item>`,
      source: 'action.data ของปุ่ม (postback)',
      example: buildMenuPostback('primary', 'item-1'),
      noPrefix: true,
    },
    {
      /* Not a payload — the rule that decides whether a button links at all.
         Stated here because "leave it out" is the answer to "how do I make a
         button that goes nowhere", and an operator looking for a field to blank
         would otherwise not find one. */
      tag: '(ไม่ใส่ postback)',
      desc: 'ปุ่มที่ไม่ต้องไปไหน เช่น ปุ่มเปิดลิงก์ — ใช้ action แบบ uri ตามปกติ ไม่ต้องมี postback',
      source: 'ปล่อยว่างได้ ไม่มีช่องให้กรอก',
      example: 'https://example.com',
      noPrefix: true,
    },
    {
      tag: `(ยาวได้ไม่เกิน ${MENU_POSTBACK_MAX_BYTES} bytes)`,
      desc: 'ข้อจำกัดของ LINE — payload ที่ยาวเกินนี้จะถูกปฏิเสธ',
      source: 'LINE Messaging API',
      example: '',
      noPrefix: true,
    },
  ];
}
