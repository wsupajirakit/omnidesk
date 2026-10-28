/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] resolve the card bound to a reply state ====
 *
 * Owner's rule, 2026-08-10: **1 reply state = 1 flex card**, picked per OA from
 * `flex_type: 'slip'` cards and stored in `hook.payment_flex_ids`.
 *
 * WHAT THIS DOES: given a state and a hook, hand back a ready-to-send flex card —
 * the admin's `content_json` with the slip's `{{tags}}` already substituted — or
 * `null` meaning "not configured, keep doing exactly what you did before".
 *
 * ⚠️ EVERY FAILURE RETURNS `null`, NEVER THROWS. This runs on the money path,
 * after the legs have already moved (or not moved) money. A deleted card, a bad
 * id, a card of the wrong type or a malformed `content_json` must degrade to the
 * previous reply — a customer who gets the old plain-text answer is fine; one who
 * gets no answer because a card lookup threw is not.
 *
 * ⚠️ TYPE IS CHECKED HERE, not trusted from the dashboard: only `flex_type: 'slip'`
 * (or a legacy card with no `flex_type`, which the FE and BE both read as `slip`)
 * is accepted. Binding a `profile` card would render a card written against a
 * different variable set, showing raw `{{…}}` to a customer.
 *
 * WHY A SEPARATE FILE: `payment-runner.service.ts` is ~2.7k lines and
 * `webhook.service.ts` ~3.7k; the owner asked repeatedly that neither grow. This is
 * also the natural seam for tests — no Nest container, just `deps`.
 * ไม่ตั้งการ์ด = คืน null = ระบบตอบเหมือนเดิมทุกอย่าง.
 *
 * revert: delete this file and its single call in `sendPaymentReply`. Every state
 * returns to its previous reply with no other change.
 */
import {
  substituteSlipTags,
  type SlipTagContext,
} from '@/modules/webhook/slip-flex/flex-slip-tags.util';

/**
 * ==== [FEAT-20260823-TOPUPDUP] state `topup_duplicate` ยืมการ์ดของ Swiftcheck ====
 *
 * WHAT: เติม default ให้แผนที่ `payment_flex_ids` — ถ้า OA **ไม่ได้ผูก**การ์ดกับ
 * state `topup_duplicate` ไว้เอง ให้ใช้ `hook.flex_duplicate` (การ์ด "สลิปซ้ำ"
 * ของสาย Swiftcheck ที่อยู่แท็บ slip) แทน
 *
 * WHY: เจ้าของเลือกทางนี้ 23/08/2026 (*"ให้ใช้การ์ด duplicate swiftcheck ได้"*) —
 * OA ส่วนใหญ่ตั้งการ์ดใบนั้นไว้อยู่แล้ว และข้อความก็ตรงความหมายพอดี ⇒ เปิดใช้ได้
 * ทันทีโดย **ไม่ต้องไปตั้งอะไรเพิ่มในหน้าเว็บ และไม่ต้องแตะ FE เลย**
 *
 * ⚠️ ของที่ผูกเอง **ชนะเสมอ** — ฟังก์ชันนี้เติมเฉพาะตอนที่ช่องนั้นว่างจริง ๆ
 *    ⇒ วันหน้าอยากได้การ์ดของตัวเองก็ผูก `payment_flex_ids.topup_duplicate` ทับ
 *
 * ⚠️ **ไม่แตะ state อื่นแม้แต่ตัวเดียว** — คืนอ็อบเจ็กต์ใหม่ที่ก๊อปของเดิมมาทั้งดุ้น
 *    แล้วเติมคีย์เดียว ⇒ hook ที่ไม่มี `flex_duplicate` ได้ของเดิมกลับไปเป๊ะ
 *
 * revert: ลบฟังก์ชันนี้ + จุดเรียกใน `webhook.service.ts` (แท็กเดียวกัน)
 *   ⇒ state `topup_duplicate` จะไม่มีการ์ด ⇒ ตอบด้วย `REPLY_TEXT.topup_duplicate`
 *   แทน ซึ่งยังใช้งานได้ปกติ ไม่พัง
 */
export function withSwiftcheckDuplicateFallback(
  /* `unknown` โดยตั้งใจ — ค่านี้มาจาก `hook['payment_flex_ids']` ซึ่งฝั่งผู้เรียก
     ก็ไม่รู้ชนิดจริงอยู่แล้ว การ narrow ที่นี่ที่เดียวตรงความจริงกว่าให้ผู้เรียก
     cast (และทำให้ call site สั้นจนไม่ต้องดัดรูปแบบ) */
  boundIds: unknown,
  swiftcheckDuplicateCardId: unknown,
): Record<string, unknown> | undefined {
  const bound =
    boundIds && typeof boundIds === 'object'
      ? (boundIds as Record<string, unknown>)
      : undefined;
  // ผูกเองไว้แล้ว = ไม่ยุ่ง · ไม่มีการ์ด Swiftcheck = ไม่มีอะไรให้เติม
  if (bound?.['topup_duplicate']) return bound;
  if (!swiftcheckDuplicateCardId) return bound;
  return { ...(bound ?? {}), topup_duplicate: swiftcheckDuplicateCardId };
}

/** The flex document fields this resolver reads. */
export interface FlexCardLike {
  _id?: unknown;
  name?: string;
  /** `'slip'`, or absent on legacy cards — both accepted. */
  flex_type?: string | null;
  content_json?: unknown;
  /** [FEAT-20260810-CARDTICKET] open a direct ticket once this card is delivered. */
  direct_ticket_on_reply?: boolean;
  /** [FEAT-20260810-CARDTICKET] the reason an admin reads on the chat divider. */
  direct_ticket_text?: string;
}

export interface PaymentStateFlexDeps {
  /** Card lookup by id. MUST resolve to `null` rather than throw on a bad id. */
  findFlexById: (id: string) => Promise<FlexCardLike | null>;
  warn: (msg: string) => void;
}

export interface PaymentStateFlexInput {
  /** The `ReplyState` whose card is wanted. */
  state: string;
  /** `hook.payment_flex_ids` — `{}`/undefined on every hook that never set one. */
  boundIds: Record<string, unknown> | null | undefined;
  /** Slip data for `{{tag}}` substitution, or `null` to substitute nothing. */
  tagContext: SlipTagContext;
}

export interface PaymentStateFlexResult {
  /** The substituted card, ready to send. */
  contents: unknown;
  /** Card name, for the log line so an operator can tell WHICH card was sent. */
  cardName: string;
  /** `{{tags}}` that could not be filled — the caller logs these. */
  leftover: string[];
  /**
   * [FEAT-20260810-CARDTICKET] Carried out so the caller can act on it AFTER the
   * reply is delivered. Read here because the card is already in hand — asking for
   * it later would mean a second query on the money path for something 99% of
   * cards leave off. `false` for every card that never set it.
   */
  ticketOnReply: boolean;
  /** [FEAT-20260810-CARDTICKET] `''` when the admin left it blank. */
  ticketText: string;
}

/**
 * Resolve the card for one reply state.
 *
 * @returns the substituted card, or `null` when this state has no card bound, the
 *   card is gone, or it is not usable — in every one of those cases the caller
 *   must fall through to its existing reply.
 */
export async function resolveStateFlex(
  input: PaymentStateFlexInput,
  deps: PaymentStateFlexDeps,
): Promise<PaymentStateFlexResult | null> {
  const { state, boundIds, tagContext } = input;

  // Nothing bound for this state — the overwhelmingly common case, and the reason
  // an existing OA sees no change at all. Cheapest exit, taken before any query.
  const rawId = boundIds?.[state];
  const id = rawId === null || rawId === undefined ? '' : String(rawId).trim();
  if (!id) return null;

  let card: FlexCardLike | null = null;
  try {
    card = await deps.findFlexById(id);
  } catch (err) {
    // A lookup failure is not a reason to leave the customer unanswered.
    deps.warn(
      `[PAYFLEX] card lookup failed for state '${state}' (id=${id}): ${
        (err as Error)?.message
      } — falling back to the default reply`,
    );
    return null;
  }

  if (!card) {
    // Bound then deleted. Worth a warning: the admin still believes it is set.
    deps.warn(
      `[PAYFLEX] state '${state}' is bound to card ${id}, which no longer exists — falling back`,
    );
    return null;
  }

  // Absent `flex_type` reads as 'slip' — that is what both the FE filter and the
  // schema default do, so legacy cards stay selectable.
  const type = String(card.flex_type ?? 'slip');
  if (type !== 'slip') {
    deps.warn(
      `[PAYFLEX] state '${state}' is bound to card ${id} of type '${type}', not 'slip' — refusing it and falling back`,
    );
    return null;
  }

  if (!card.content_json) {
    deps.warn(
      `[PAYFLEX] card ${id} for state '${state}' has no content_json — falling back`,
    );
    return null;
  }

  try {
    const { contents, leftover } = substituteSlipTags(
      card.content_json,
      tagContext,
      { report: true },
    ) as { contents: unknown; leftover: string[] };

    return {
      contents,
      cardName: String(card.name ?? id),
      leftover,
      // [FEAT-20260810-CARDTICKET] surfaced, not acted on — this resolver renders.
      ticketOnReply: card.direct_ticket_on_reply === true,
      ticketText: String(card.direct_ticket_text ?? '').trim(),
    };
  } catch (err) {
    // `content_json` that cannot survive stringify/parse (cycles, exotic values).
    deps.warn(
      `[PAYFLEX] card ${id} for state '${state}' could not be rendered: ${
        (err as Error)?.message
      } — falling back`,
    );
    return null;
  }
}
