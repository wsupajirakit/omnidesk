/**
 * [FEAT-20260819-REGSOURCE] "ลงทะเบียนโดย" — reading the stamp the BE writes.
 * ===========================================================================
 * A customer's account link is created one of two ways and they look identical
 * afterwards: the customer opened the LIFF page and did it themselves, or an
 * admin pressed the button for them. The BE records which, once, at the moment
 * it happens (`members.link_registered_by` / `link_registered_at`).
 *
 * ⚠️ NOT the same as the "สมัครเมื่อ" already on the customer panel. That one is
 * `raw_profile_data…registered_at` from the third-party site — when the customer
 * signed up THERE. This is when OUR link was made. Two facts, one panel, so the
 * label has to say which. อย่าสลับกับ "สมัครเมื่อ" ของ shop-api.
 *
 * `null` / absent is the common case, not an error: every customer registered
 * before the field existed has none, and it is deliberately never backfilled —
 * a guessed source would be a silent lie. Those rows read "-".
 *
 * 🔗 CROSS-REPO: the values come from `omnidesk-api`'s `REGISTERED_BY`. The BE
 * decides what is stored; this file only decides how it reads. Adding a value
 * there without adding it here shows the operator a raw code — which is the
 * honest fallback, but not the intended one. BE ตัดสินค่า · ที่นี่ตัดสินคำแปล.
 *
 * revert: delete this file and the two rows that call it in TicketChat.tsx.
 */
import { translateNow } from '../../i18n';

/**
 * What the BE can store — kept in step with `REGISTERED_BY` in
 * `omnidesk-api/src/modules/customer-link/registration-stamp.helper.ts`.
 *
 * ⚠️ `system` WAS RENAMED TO `member` on 2026-08-20 and BOTH ARE LISTED HERE ON
 * PURPOSE. The BE stopped writing `system` that day, but rows written before it
 * still hold the word and mean exactly the same thing — a customer who
 * registered themselves. Dropping it would make those rows render as the raw
 * string `system` in the panel, which is why the BE keeps it on its accepted
 * list too. แถวเก่ายังเป็น system · ต้องแปลเหมือน member ไม่งั้นโชว์ดิบ.
 *
 * `agent_auto`, `semi_admin` and `other` are reserved: the BE accepts them,
 * nothing writes them yet, and they are mapped here so the day something does,
 * the panel reads properly on the first row instead of showing a code.
 *
 * ⚠️ `semi_admin` was `semi-admin` for one afternoon, and the hyphen exposed a
 * real hole here: the regex reading the BE list in
 * `test/registrationSource.value.test.ts` was `/'([a-z_]+)'/g`, which does not
 * match one — so the guard returned five values for a list of six and went on
 * reporting that every value had a label. The value moved to an underscore (the
 * BE counted 260 underscore values and zero hyphenated ones), and the regex was
 * widened ANYWAY and kept that way, because the next person to reach for a
 * hyphen should not rediscover this. ตัวกันกว้างไว้ ถึงค่าตอนนี้จะไม่ต้องใช้แล้ว.
 */
export type RegisteredBy =
  | 'admin'
  | 'member'
  | 'agent_auto'
  | 'semi_admin'
  | 'other'
  | 'system';

/* DESTINATION 5 of 7 — the far end of the chain that starts at
   `omnidesk-api/src/modules/customer-link/registration-stamp.helper.ts`.
   A value that reaches here without an entry below renders as the RAW KEY on
   the panel: no error, no blank, just `agent_auto` sitting where Thai should be.
   ⚠️ NO SECOND COLUMN IS COMING. `link_registered_support` was proposed and
   dropped on 2026-08-21 by owner decision — precisely because it would have
   carried its own `other` alongside the one below, and the same word would then
   have meant two different things depending on which field you read. A new
   source is a new entry in THIS map, and nothing else moves. */
const LABELS: Record<string, string> = {
  admin: 'แอดมิน',
  member: 'ลูกค้าลงทะเบียนเอง',
  agent_auto: 'ระบบทำให้อัตโนมัติ',
  /* Between admin and member: the customer submitted it themselves, but only
     after an operator or an assistant walked them to it. Neither of the other
     two words is honest about that. Nothing writes it yet — the label is here
     first so the first row that does never renders as a raw code.
     ⚠️ ข้อความนี้แก้ได้อิสระ ไม่ใช่ค่าที่เก็บใน DB — ค่าที่เก็บคือ 'semi_admin' */
  semi_admin: 'แอดมินช่วยบางส่วน',
  other: 'อื่น ๆ',
  // legacy name for `member` — see the note above. Same label, deliberately.
  system: 'ลูกค้าลงทะเบียนเอง',
};

/**
 * One line for the customer-info panel, or `null` when we do not know.
 *
 * An unknown non-null code renders as itself rather than blank or "อื่น ๆ": if
 * the BE ever adds a source the dashboard has not learned yet, showing the raw
 * value is honest, and a blank cell would look like a bug.
 * ค่าที่ยังไม่รู้จัก = โชว์ตามจริง ไม่กลืนหาย.
 *
 * @param formatAt the page's own date formatter, passed in rather than
 *   duplicated here — one clock format on the page, not two.
 */
export function registrationText(
  by: string | null | undefined,
  at: string | null | undefined,
  formatAt: (iso?: string | null) => string,
): string | null {
  if (!by) return null;
  /* [FEAT-20261022-I18NTICKETEN] the label speaks the UI language (`ticketui.panel.reg_<code>`);
     an unknown code still shows as itself */
  const who = LABELS[by] ? translateNow(`ticketui.panel.reg_${by}`, LABELS[by]) : by;
  const when = at ? formatAt(at) : '';
  return when ? `${who} · ${when}` : who;
}
