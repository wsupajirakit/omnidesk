/**
 * [FEAT-20260816-WALLETPAYCARD] SECOND masking layer, applied at render time.
 *
 * The BE already masks (~70% hidden) before it answers — this repeats the rule
 * on the client so a value can only reach the screen if BOTH layers miss it.
 * Cheap (pure, runs on one page of rows) and it keeps the card honest even if
 * someone later points it at an unmasked source.
 * ปิดสองชั้น: ฝั่ง BE ปิดมาแล้ว ตอน render ปิดซ้ำอีกที.
 *
 * Same SHAPE-based rule as the server (`walletpay-mask.util.ts`): UUID, LINE user
 * id, Mongo ObjectId — whole values and ids embedded in longer strings — while
 * amounts, timestamps, statuses and words are never touched. Kept as a small
 * separate module (not inlined in the card) so the card file stays readable and
 * this can be unit-tested on its own.
 *
 * revert: delete this file with the rest of the folder.
 */
// [FIX-20260816-BLUR90] 10% visible ⇒ ~90% masked — must stay equal to the BE
// constant in walletpay-mask.util.ts, or the two layers disagree on how much shows.
const VISIBLE_RATIO = 0.1;
const MIN_KEEP = 2;

/* [FIX-20260816-REFIDCLEAR] NO UUID rule — refId must stay readable (owner 16/08:
   an admin pastes it into walletpay's console; it is not a secret). Mirrors the BE
   list in walletpay-mask.util.ts — keep the two equal.
   [FIX-20260816-BLURSTORAGE] long hex covers s3 object names and `sig=` tokens. */
const EMBEDDED: RegExp[] = [
  /\bU[0-9a-f]{32}\b/gi, // LINE user id
  /\b[0-9a-f]{24}\b/gi, // Mongo ObjectId
  /\b[0-9a-f]{16,}\b/gi, // storage object name / signature inside URLs
];

export function maskValue(v: string): string {
  const keep = Math.max(MIN_KEEP * 2, Math.floor(v.length * VISIBLE_RATIO));
  if (v.length <= keep + 1) return v;
  const head = Math.max(MIN_KEEP, Math.ceil(keep / 2));
  const tail = Math.max(MIN_KEEP, keep - head);
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/** Mask ids inside any string — whole value or embedded. */
export function maskText(text: string): string {
  let out = text;
  for (const re of EMBEDDED) out = out.replace(re, (m) => maskValue(m));
  return out;
}

/** Walk any JSON-ish value; never throws, never mutates the input. */
export function maskDeep(input: unknown, depth = 0): unknown {
  if (depth > 12) return '[…]';
  if (typeof input === 'string') return maskText(input);
  if (Array.isArray(input)) return input.map((v) => maskDeep(v, depth + 1));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = maskDeep(v, depth + 1);
    }
    return out;
  }
  return input;
}

/**
 * ⚠️ [FIX-20260816-TRACEBLUR] SUPERSEDED — kept only as a helper, NOT used by the
 * card any more. The three trace handles are blurred by the BE before the
 * response is sent; blurring them here would have left the real value in the
 * network payload. Do not reintroduce it.
 *
 * Original note: display blur for the three TRACE handles shown in the
 * modal header (`job_ref`, `run_id`, `result_id`).
 *
 * They arrive from the BE in full on purpose — they are our own ids and the
 * whole point is to trace an event back to the handoff log. The owner asked for
 * them to be blurred ~50% ON SCREEN, in the MIDDLE, so the two ends stay
 * recognisable (that is what people compare by eye) while a shoulder-surfer
 * cannot copy the value off a screenshot.
 * ⚠️ Presentation only: nothing else consumes this, and the underlying value in
 * the payload is untouched. เบลอเฉพาะตอนแสดงผล ค่าจริงยังอยู่.
 */
export function blurMiddle(value: string, visibleRatio = 0.5): string {
  const v = String(value ?? '');
  const keep = Math.max(4, Math.floor(v.length * visibleRatio));
  if (v.length <= keep + 1) return v;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}
