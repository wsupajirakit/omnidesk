/**
 * ==== [FEAT-20260902-SLIPPROVIDER] redact the slip image out of a stored request
 *
 * WHAT: given the body that went on the wire and the name of the key holding the
 * image, return the object safe to persist as `raw_request`.
 *
 * WHY IT IS A FUNCTION AND NOT THREE INLINE SPREADS. The caller writes
 * `raw_request` at three sites — the webhook log, VARIANT 1 and VARIANT 2 — and
 * each one spelled the key out as the literal `base64`. That is correct for
 * Swiftcheck and silently wrong for anything else: SlipGuard names the field `files`,
 * so those three lines would add a phantom `base64` key **and leave the entire
 * base64 image in `webhook_logs.raw_request` and
 * `slip_verifications.raw_request`**. A slip image in the logs is a data leak
 * and a storage problem at once, and the existing guard only checks Swiftcheck's
 * key name, so it would not fire.
 *
 * Three sites meant three chances to forget. One function means the provider's
 * `imageField` decides, once.
 *
 * ⚠️ BEHAVIOUR IS UNCHANGED FOR SWIFTCHECK. `imageField` is `'base64'` there, so
 * the output is the same object shape it always was — proved by the goldens,
 * which were recorded before any of this existed.
 *
 * ⚠️ IT DOES NOT INVENT THE KEY. If the body has no such key, nothing is added:
 * a redaction placeholder standing in for an image that was never sent would be
 * a lie in the log. It only replaces what is there.
 *
 * revert: inline `{ ...body, base64: BINARY_PLACEHOLDER }` back at the three
 * sites and delete this file.
 */

/** legacy:2853 — the marker written in place of the image bytes. */
export const BINARY_PLACEHOLDER = '[BINARY_DATA]';

/**
 * @param body the request body as sent
 * @param imageField which key holds the image, from `SlipVerifyRequest.imageField`
 * @returns a copy safe to persist; the original is never mutated
 */
export function redactImageField(
  body: Record<string, unknown>,
  imageField: string,
): Record<string, unknown> {
  const out = { ...body };
  if (!imageField) return out;

  /* [FIX-20260903-NESTEDIMAGEFIELD] A DOTTED PATH REACHES A NESTED FIELD.
   *
   * This used to be `imageField in out` — top level only. Measured against
   * Slip2Go's real documentation on 03/09: its request nests everything under
   * `payload` (`payload.qrCode`, `payload.checkCondition`), so a provider naming
   * its image field `payload.image` would have matched NOTHING and written the
   * whole base64 slip image into `webhook_logs.raw_request` and
   * `slip_verifications.raw_request` — the exact leak this file exists to
   * prevent, one level deeper and just as silent.
   *
   * Swiftcheck's `'base64'` has no dot, so it takes the same single-segment path it
   * always did and its behaviour is byte-identical — which the goldens pin.
   *
   * ⚠️ STILL DOES NOT INVENT A KEY. A path whose parent is missing, or is not an
   * object, leaves the body untouched: a placeholder standing in for an image
   * that was never sent would be a lie in the log.
   * ⚠️ COPIES ONLY THE PARENTS IT REWRITES, so the caller's object is never
   * mutated at any depth — `raw_request` is persisted from it.
   * path มีจุด = เจาะเข้าไปในชั้นใน · ของเดิมไม่มีจุด จึงไม่เปลี่ยนพฤติกรรม */
  const segments = imageField.split('.');
  let cursor: Record<string, unknown> = out;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i]!];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      return out;
    }
    const copy = { ...(next as Record<string, unknown>) };
    cursor[segments[i]!] = copy;
    cursor = copy;
  }
  const leaf = segments[segments.length - 1]!;
  if (leaf in cursor) cursor[leaf] = BINARY_PLACEHOLDER;
  return out;
}
