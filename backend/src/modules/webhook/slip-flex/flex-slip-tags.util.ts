/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] slip `{{tag}}` substitution — one copy ====
 *
 * WHAT: turns a verified slip into the tag→value map an admin's flex card is
 * written against, and substitutes those tags into the card JSON.
 *
 * WHY IT IS ITS OWN FILE: two callers need the identical behaviour.
 *   1. `slip-flex.handler.ts` — the legacy slip card (the original home).
 *   2. the payment reply path — a card bound to a payment reply state
 *      (`hook.payment_flex_ids`) is authored with the SAME tags, because an
 *      admin writing "ยอด {{amount}} บาท" expects it to work on any slip card.
 * Copying the block into the payment side would have meant two implementations
 * of a customer-visible format, drifting apart the first time one is touched.
 *
 * ⚠️ LIFTED VERBATIM from `slip-flex.handler.ts` (`legacy:3556-3596`), which is
 * itself a byte-faithful port. The formats here are what customers already read,
 * so they are a CONTRACT, not an implementation detail:
 *   · `amount` uses `en-US` grouping with exactly 2 decimals — "1,500.00".
 *   · missing values become the string `'N/A'`, never `''` or `undefined`.
 *   · `date_on_slip` / `current_datetime` are legacy SYNONYMS kept populated.
 *   · matching is case-insensitive and tolerates `{{ tag }}` — cards in the wild
 *     rely on both.
 * Behaviour is pinned by `z-test/unit/flex-slip-tags.spec.ts`, written BEFORE
 * this extraction so "nothing changed" is measured rather than asserted.
 * แก้ format ตรงนี้ = เปลี่ยนสิ่งที่ลูกค้าเห็นบนการ์ดทุกใบ.
 *
 * revert: inline `buildSlipTagMap` + `substituteSlipTags` back into
 * `slip-flex.handler.ts` and delete this file. No behaviour depends on the split.
 */
import { formatSlipDate, getBankLogoUrl } from './slip-flex.handler';

/** The slip fields the tag map reads — Swiftcheck's `rawSlip`, loosely typed. */
export interface SlipTagSource {
  amount?: { amount?: number };
  date?: unknown;
  sender?: {
    bank?: { id?: unknown; name?: unknown };
    account?: {
      name?: { th?: string; en?: string };
      bank?: { account?: string };
    };
  };
  receiver?: {
    bank?: { id?: unknown; name?: unknown };
    account?: {
      name?: { th?: string; en?: string };
      bank?: { account?: string };
      /* [FIX-20260825-NATIDTAGS] ผู้รับที่เป็น PromptPay ส่งมาเป็น `proxy` แทน `bank`
         — ทั้งสองไม่เคยมาพร้อมกัน · ประกาศไว้เฉพาะฝั่งผู้รับ เพราะฝั่งผู้ส่ง
         เป็นบัญชีจริงเสมอ (ความไม่สมมาตรที่ legacy ตั้งใจ ดู slip-flow.service.ts:381) */
      proxy?: { type?: string; account?: string };
    };
  };
}

export interface SlipTagContext {
  /** Swiftcheck's `rawSlip`. `null` ⇒ no substitution is possible. */
  vData: SlipTagSource | null | undefined;
  /** Served base URL, prepended to bank logos. */
  baseUrl: string | null | undefined;
  /** When WE checked the slip (not the slip's own timestamp). */
  slipCreatedAt: Date | string | number | null | undefined;
  /** The caller's Thai date formatter, injected so both callers agree. */
  formatThaiDateTime: (d: SlipTagContext['slipCreatedAt']) => string;
}

/**
 * Build the tag→value map for one slip.
 *
 * Every value is a string, and every absent field becomes `'N/A'` — a blank would
 * leave a hole in the card where a customer expects a value.
 */
export function buildSlipTagMap(ctx: SlipTagContext): Record<string, string> {
  const { vData, baseUrl, slipCreatedAt, formatThaiDateTime } = ctx;
  const v = vData ?? {};

  const amountValue = v.amount?.amount || 0;
  const formattedAmount = Number(amountValue).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const tags: Record<string, string> = {
    amount: formattedAmount,
    slip_date: v.date ? formatSlipDate(v.date) : 'N/A',
    check_datetime: formatThaiDateTime(slipCreatedAt),
    sender_bank_logo: getBankLogoUrl(v.sender?.bank?.id, baseUrl),
    sender_bank_name: (v.sender?.bank?.name as string) || 'N/A',
    sender_name:
      v.sender?.account?.name?.th || v.sender?.account?.name?.en || 'N/A',
    sender_acc_no: v.sender?.account?.bank?.account || 'N/A',
    receiver_bank_logo: getBankLogoUrl(v.receiver?.bank?.id, baseUrl),
    /* [FIX-20260825-NATIDTAGS] ผู้รับที่เป็น PromptPay ไม่มี `bank` และไม่มี
       `account.bank` — มีแต่ `account.proxy` ⇒ ทั้งชื่อแบงค์และเลขบัญชีตกลง 'N/A'
       บนการ์ดที่ลูกค้าเห็น (เจ้าของแจ้ง 25/08 พร้อม rawSlip จริง)

       🔴 กติกานี้มีอยู่ในระบบแล้ว ไม่ได้คิดใหม่ — `slip/slip-flow.service.ts:381-385`
          ทำ fallback ไป `proxy.account` อยู่ก่อนแล้ว พร้อมคอมเมนต์ว่า
          "Receiver falls back to the PROXY account (PromptPay); sender does not.
           That asymmetry is legacy's and is correct — a sender is always a real
           account, a receiver may be a proxy."
          ไฟล์นี้แค่ไม่ได้ตามกติกาเดียวกัน ⇒ ทำให้ตรงกัน

       ⚠️ ผู้ส่งไม่แตะ — `sender_acc_no` ยังอ่านจาก `account.bank` อย่างเดียว
          ตามความไม่สมมาตรที่ legacy ตั้งใจไว้
       ⚠️ ชื่อแบงค์เดาได้เฉพาะ `NATID` เท่านั้น · proxy ชนิดอื่น (เช่น MSISDN)
          โชว์เลขได้แต่ชื่อยังเป็น 'N/A' — เจ้าของระบุมาเฉพาะ NATID
          การเดาว่าทุก proxy คือ PromptPay จะเป็นการบอกลูกค้าในสิ่งที่ยังไม่รู้
       ⚠️ ไฟล์นี้เป็น display-only — เครดิต/topup/walletpay/swiftcheck อ่าน `rawSlip`
          ตรง ไม่ผ่านตัวนี้ ⇒ แก้ตรงนี้แตะได้แค่สิ่งที่ตาเห็น
       revert: คืนสองบรรทัดเดิม (`bank?.name || 'N/A'` และ `account?.bank?.account || 'N/A'`) */
    receiver_bank_name:
      (v.receiver?.bank?.name as string) ||
      (v.receiver?.account?.proxy?.type === 'NATID' ? 'Promptpay' : '') ||
      'N/A',
    receiver_name:
      v.receiver?.account?.name?.th || v.receiver?.account?.name?.en || 'N/A',
    receiver_acc_no:
      v.receiver?.account?.bank?.account ||
      v.receiver?.account?.proxy?.account ||
      'N/A',
  };
  // legacy:3578-3579 — synonyms for the two most-used tags.
  tags['date_on_slip'] = tags['slip_date'] as string;
  tags['current_datetime'] = tags['check_datetime'] as string;

  return tags;
}

export interface SubstituteResult {
  /** The card with every known tag replaced. */
  contents: unknown;
  /** `{{tags}}` still present — an unknown tag, or one this slip cannot fill. */
  leftover: string[];
}

/**
 * Substitute the slip tags into a card.
 *
 * Works on the STRINGIFIED card (legacy did the same), so a tag is replaced
 * wherever it appears — text, image url, nested contents — without walking the
 * tree. The input is never mutated.
 *
 * `vData` absent ⇒ the card is returned untouched: better a card with visible
 * braces, which an operator will notice and report, than one filled with 'N/A'
 * everywhere as if the data had genuinely been read.
 *
 * @param opts.report pass `true` to receive `{contents, leftover}` instead of just
 *   the card, so the caller can warn about leftovers exactly as the handler does.
 */
export function substituteSlipTags(
  contentJson: unknown,
  ctx: SlipTagContext,
  opts?: { report?: boolean },
): unknown | SubstituteResult {
  if (!contentJson || !ctx.vData) {
    return opts?.report ? { contents: contentJson, leftover: [] } : contentJson;
  }

  const tags = buildSlipTagMap(ctx);

  // legacy:3581-3588 — braced-only `{{tag}}` / `{{ tag }}`, case-insensitive,
  // applied to the serialised card.
  let flexString = JSON.stringify(contentJson);
  for (const tag of Object.keys(tags)) {
    const tagValue = String(tags[tag] || '').trim();
    /*
     * ==== [FIX-20260819-SLIPTAGESCAPE] the value lands INSIDE a JSON string
     *
     * Six tags (`sender_bank_name`/`sender_name`/`sender_acc_no` and the three
     * receiver twins) are third-party strings copied out of the slip-verification
     * response with no coercion, and they were spliced in raw. Measured on the
     * pre-fix code: a `"` in a bank name silently INJECTED a property into the
     * card node (`{"type":"text","text":"BANK","color":"#ff0000"}`) with no error
     * at all, and a trailing `\` made `JSON.parse` throw. The remaining tags
     * cannot carry either character today — `amount` is `Number()`-coerced and
     * the dates are built from digits and fixed month names. The two logo tags
     * are NOT in that safe set, though it reads that way: `getBankLogoUrl`
     * prefixes `ctx.baseUrl`, and webhook.controller.ts:137-139 falls back to
     * `req.get('host')` when `BASE_URL` is unset — which it is here. Reaching it
     * still costs a valid LINE signature, so it is the lesser surface, but it is
     * a surface. Hence the escape runs over EVERY tag, not just the six OCR
     * ones; narrowing it to a hand-picked list would silently reopen this.
     *
     * `JSON.stringify(v).slice(1, -1)` is the string-literal BODY of `v`: for
     * ordinary text (Thai included) it returns the identical characters, so the
     * card customers already read does not move by one byte — pinned by
     * `flex-slip-tags-escape.spec.ts`, whose expected output was captured from
     * this function BEFORE the fix.
     *
     * The replacement is a FUNCTION, not a string, for a second reason on the
     * same line: `String.replace` expands `$&` / `$'` / `` $` `` inside a
     * replacement STRING, so a value containing `$'` spliced the rest of the
     * serialised card into the literal and threw as well. A function's return
     * value is used verbatim. Escaping alone would not have closed that.
     *
     * revert: `.replace(regexBraced, tagValue)` and drop `jsonSafe`.
     * ค่าจากสลิปต้องเป็น "ค่า" เสมอ ห้ามกลายเป็นโครงสร้างของการ์ด.
     */
    const jsonSafe = JSON.stringify(tagValue).slice(1, -1);
    const regexBraced = new RegExp(`\\{\\{\\s*${tag}\\s*\\}\\}`, 'gi');
    flexString = flexString.replace(regexBraced, () => jsonSafe);
  }

  const leftover = flexString.match(/\{\{.*?\}\}/g) ?? [];
  const parsed = JSON.parse(flexString) as unknown;

  return opts?.report ? { contents: parsed, leftover: [...leftover] } : parsed;
}
