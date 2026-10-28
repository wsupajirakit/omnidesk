/**
 * [FEAT-20260831-MENUVARSET] The `{{paylink.*}}` rows the flex editor offers.
 * ===========================================================================
 * Owner, 31/08: a MENU card may carry the contact-admin button. Before this the
 * tag existed only in the send path and in the FE's slip table, so typing it on
 * a menu card was refused at save — the guide table IS the allowlist
 * (`FlexMessageFormModal.tsx:663`), and a tag missing from it cannot be stored.
 *
 * ⚠️ THE TAG IS BUILT, NEVER TYPED. `payLinkTag` and the action names come
 * from `@/common/utils/paylink-tag`, the same leaf the minter reads. A copy
 * here would be a second spelling of a grammar that lives somewhere else, and
 * the day an action is renamed the guide would keep offering a tag the send path
 * silently no longer mints — leaving `{{paylink.…}}` on a customer's screen.
 * Same rule, same reason as `menu-postback-guidelines.ts`.
 *
 * ⚠️ ONLY `contact_admin` IS OFFERED, and only to the card types that ask for
 * it. `retry` resumes a payment run: on a menu card there is no run, so the
 * minter would delete the whole button node and the operator would never learn
 * why. Offering it would be a promise the send path cannot keep.
 *
 * revert: delete this file and its call in `flex-messages.service.ts`; the rows
 *         disappear and a menu card is refused the tag again.
 */
import {
  payLinkTag,
  PAYLINK_OFFERED,
  PAYLINK_TAG_FIELD,
} from '@/common/utils/paylink-tag';

import type { GuidelineRow } from './flex-var-guidelines';

/**
 * [FIX-20260831-PAYLINKGUIDE] ONE ROW PER OFFERED TAG, read from the shared
 * list — this file used to hard-code the single name it knew, so a tag added to
 * the grammar was minted correctly and then REFUSED ON SAVE, because this table
 * doubles as the allowlist. Adding a tag is now a row in `PAYLINK_OFFERED`
 * and nothing here changes at all.
 */
export function buildPayLinkGuidelines(flexType?: string): GuidelineRow[] {
  /* [FIX-20260831-PAYLINKONESOURCE] filtered by CARD TYPE, because the offered
     set genuinely differs: `retry` needs a payment run to resume and belongs to
     `slip` alone. Omitting the argument keeps every existing caller's answer.
     ⚠️ This is now the ONLY list of these tags in the product. The dashboard had
        its own hard-coded copy (`config/flexSlipGuidelines.ts`) which never
        learned about a new tag — the exact failure the owner hit. */
  return PAYLINK_OFFERED.filter(
    (t) => !flexType || t.types.includes(flexType),
  ).map((t) => {
    const field = PAYLINK_TAG_FIELD[t.name];
    /* [FEAT-20260902-ADMINPOSTBACK] the button KIND is derived, never hardcoded.
       This line used to say "ปุ่มชนิด message" for every row, which was already
       wrong for `retry` (authored on a postback button) and would have become
       wrong for the contact tags too. `data` is only ever written on a postback
       action and `text` only on a message one, so the field decides the kind.
       ⚠️ The contact tags stay AUTHORED on a message button and are rewritten
          into a postback at send time — the operator does not do that, and must
          not be told to, or they would move the tag into the wrong field and the
          minter would drop the whole button. See paylink-tag.ts. */
    const kind = field === 'data' ? 'postback' : 'message';
    return {
      tag: payLinkTag(t.name),
      desc: `${t.label} — วางในปุ่มชนิด ${kind} ที่ช่อง "${field}" ระบบจะเติมค่าให้ตอนส่ง (วางผิดช่อง = ปุ่มถูกตัดทิ้งทั้งอัน)`,
      source: `action.${field} ของปุ่ม (${kind})`,
      example: t.example,
      /* `noPrefix` = the row is already spelled in full — the namespace is part
         of the tag. Same marker the menu payload rows carry, for the same
         reason: nothing downstream may wrap it again. */
      noPrefix: true,
    };
  });
}
