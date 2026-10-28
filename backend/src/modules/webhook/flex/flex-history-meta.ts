import { HELPER_ALT_TEXT } from '../hook-reply/customer-helper-flex';

import type { FlexReplyOut } from './flex-reply-out';

/**
 * [FIX-20260822-FLEXHISTORYTYPE] The three history fields of a sent card,
 * derived ONCE from the kind that was actually sent.
 *
 * THE BUG (owner, 22/08): three card kinds converge into one variable at the
 * send site — [[[flex_profile]]], [[[flex_mNNNNN]]], [[[flex_pcNNNNN]]] — and
 * the history patch chose between only two labels (helper / profile). Every
 * flex_m and flex_pc card was therefore stored as `flex_profile`, with the
 * PROFILE doc's id in `flex_doc_id` and "[Flex] ข้อมูลโปรไฟล์" as its text.
 * On the local clone, 11 of 11 rows labelled flex_profile were not profile
 * cards. The customer was never affected — the card was already sent — but
 * the admin screen, the room preview and any count of "profile cards sent"
 * were wrong.
 *
 * WHY ONE FUNCTION: the history `$set` and the realtime publish must carry the
 * same three values (the live screen and a refresh must agree). Deriving them
 * here, once, makes that a property rather than a discipline.
 *
 * Labels `flex_tag` / `flex_pc` are NEW values of `auto_reply_type`. Checked
 * before choosing them: the only reader is follow-up/abandon-trigger.rule.ts,
 * which matches `flex_customerhelper` and the bound helper card id — neither
 * is touched. The FE never reads the field. Rows written before this fix keep
 * their old label (no backfill, owner's rule).
 *
 * revert: delete this file; restore the two ternaries in webhook.service.ts.
 */

export type FlexCardKind =
  | 'helper'
  | 'profile'
  | 'tag'
  | 'pc'
  /* [FEAT-20260831-MENUMAINTAG] a stored MENU card, summoned by its minted tag
     (`[[[menu_main_00001]]]`). Listed so the history row says what actually went
     out — before this the only labels were the three flex families, and a menu
     card would have been filed as whichever branch happened to be last. */
  | 'menu';

export interface FlexHistoryMeta {
  auto_reply_type:
    | 'flex_customerhelper'
    | 'flex_profile'
    | 'flex_tag'
    | 'flex_pc'
    /* [FEAT-20260831-MENUMAINTAG] checked against the reader before adding, the
       same way `flex_tag`/`flex_pc` were. The consumer is the abandon lookback
       (`follow-up/abandon-trigger.rule.ts:159`), which skips exactly ONE prefix —
       `flex_notice_` — so a `flex_menu` row counts as an ordinary bot reply,
       precisely as a `flex_tag` row does today. The FE does not read the field.
       Rows written before today are untouched. */
    | 'flex_menu';
  flex_doc_id: string | null;
  content: string;
}

/** ObjectId (toHexString) or non-empty string → text; anything else → null. */
const asId = (v: unknown): string | null => {
  if (typeof v === 'string') return v || null;
  if (
    v &&
    typeof v === 'object' &&
    typeof (v as { toHexString?: unknown }).toHexString === 'function'
  ) {
    return (v as { toHexString: () => string }).toHexString();
  }
  return null;
};

export function flexHistoryMeta(input: {
  kind: FlexCardKind;
  hook: Record<string, unknown> | null | undefined;
  out: FlexReplyOut;
  replyBody: string | null | undefined;
}): FlexHistoryMeta {
  const { kind, hook, out } = input;
  const body = (input.replyBody ?? '').trim();
  switch (kind) {
    case 'helper':
      return {
        auto_reply_type: 'flex_customerhelper',
        flex_doc_id: asId(hook?.['flex_customerhelper_id']),
        content: `[Flex] ${body || HELPER_ALT_TEXT}`,
      };
    case 'profile':
      return {
        auto_reply_type: 'flex_profile',
        flex_doc_id: asId(out.docId) ?? asId(hook?.['flex_profile_id']),
        content: `[Flex] ${body || 'ข้อมูลโปรไฟล์'}`,
      };
    case 'tag':
    case 'pc':
      return {
        auto_reply_type: kind === 'tag' ? 'flex_tag' : 'flex_pc',
        // never the profile id: if the builder did not report a doc, say so
        flex_doc_id: asId(out.docId),
        content: `[Flex] ${body || out.name || 'การ์ด'}`,
      };
    /* [FEAT-20260831-MENUMAINTAG] a stored MENU card. Its own label rather than
       a reuse of `flex_tag`: an operator reading the history has to be able to
       tell a menu apart from a custom card, and the two are reached by different
       markers and different permission rules. `flex_doc_id` is whatever the
       renderer reported — never a hook field, because a menu card is not bound
       to the hook the way a profile/helper card is. */
    case 'menu':
      return {
        auto_reply_type: 'flex_menu',
        flex_doc_id: asId(out.docId),
        content: `[Flex] ${body || out.name || 'เมนู'}`,
      };
  }
}
