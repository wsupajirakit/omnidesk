/**
 * [REFACTOR-20260905-CUSTPROV] Reading a customer's own contact fields.
 * ===========================================================================
 * Two pure helpers that lived inside the 2,780-line profile panel but are used
 * by `TicketChat.tsx` OUTSIDE it (`:2378`, `:2563`, `:4838`, `:6571-6577`). That
 * made ticket import the panel module to answer "what is this customer's phone",
 * which is not the panel's question.
 *
 * They sit beside `customerName.ts` — same role (one place that decides what a
 * customer's own fields say), same reason its header gives: *"lives here so
 * chat/ticket/contact can share it without importing each other"*.
 *
 * 🔴 MOVED VERBATIM. Both bodies are byte-identical to what the panel had; the
 * `detail` split rule in particular is a legacy format nobody redesigned here.
 *
 * revert: paste both back into `profile-panel/ProfilePanel.tsx` and re-export
 *         them from its barrel.
 */

/**
 * The pipe-delimited `detail` string a customer-link flow writes.
 * Format: `name|phone|contract`. Missing parts read as `''`, never `undefined`,
 * so callers can concatenate without guarding.
 */
export function parseCustomerDetail(raw?: string | null) {
  const p = (raw || '').split('|');
  return { name: p[0] || '', phone: p[1] || '', contract: p[2] || '' };
}

/**
 * The customer's phone, from the field if present and from the `detail` string
 * if not.
 *
 * ⚠️ Whitespace-only counts as absent on BOTH sources — a `phone_number` of
 * `' '` must fall through to `detail`, not win with a blank. That is why each
 * branch trims before deciding, rather than testing truthiness once.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- line_user_data is untyped upstream
export function getCustomerPhone(ud: any): string {
  if (!ud) return '';
  if (ud.phone_number && String(ud.phone_number).trim())
    return String(ud.phone_number).trim();
  if (ud.detail) {
    const parts = String(ud.detail).split('|');
    if (parts[1] && parts[1].trim()) return parts[1].trim();
  }
  return '';
}
