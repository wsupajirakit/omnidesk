/**
 * [FEAT-20261020-TICKETSTACK] "Same customer on the same OA" — the key a stack is
 * built on.
 *
 * Why these two fields (measured 20/10 on demoloan, the loan scratch DB and the
 * 176-row dev DB, not assumed):
 *   - `line_oa_hook_id` — set on every row of all three. `hook_id` is the mirror
 *     and is null on one legacy row, so it is only the fallback.
 *   - `line_user_id` — on a list row this is the MEMBER `_id` (the BE's
 *     formatTicket puts it there), set on every row. Members are unique per LINE
 *     user across ALL OAs, so the member alone would merge one person's tickets
 *     from two different OAs — the OA half is what keeps them apart.
 *
 * Provider-independent: no customer provider (shopapi_v1, loan_v1) writes identity
 * onto a ticket or a member — they only read `raw_profile_data`. So the key is
 * the same whatever CUSTOMER_PROVIDER the site runs.
 *
 * Either half missing ⇒ `null` ⇒ the ticket stays on its own (never guess a group).
 * Phone numbers and names are deliberately NOT used: they merged strangers once
 * already ([FIX-20260814-TICKETIDENTITY] in ticketIdentity.ts).
 */
export interface StackableTicket {
  _id: string;
  line_oa_hook_id?: unknown;
  hook_id?: unknown;
  line_user_id?: unknown;
  line_user_data?: { _id?: unknown } | null;
  created_at?: string | null;
}

const idText = (value: unknown): string => {
  const s = String(value ?? '').trim();
  return s && s !== 'undefined' && s !== 'null' && s !== '[object Object]' ? s : '';
};

export function ticketStackKey(tk: StackableTicket): string | null {
  const oa = idText(tk.line_oa_hook_id) || idText(tk.hook_id);
  const member = idText(tk.line_user_id) || idText(tk.line_user_data?._id);
  return oa && member ? `${oa}|${member}` : null;
}
