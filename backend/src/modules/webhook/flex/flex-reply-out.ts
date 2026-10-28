/**
 * [FIX-20260822-FLEXHISTORYTYPE] What a flex builder rendered, reported back
 * to the caller that must write history. Optional on every builder: a caller
 * that passes nothing (every existing call and spec) gets exactly the old
 * behaviour; the webhook passes one so the history row can name the RIGHT card
 * and doc instead of labelling every card "flex_profile". Filled only when a
 * card was actually rendered; left empty on every null return.
 *
 * Own file so flex-profile-reply.builder.ts stays under the 400-line ratchet.
 */

export interface FlexReplyOut {
  docId?: string;
  name?: string;
}

/** ObjectId (has toHexString) or string → text; anything else → undefined. */
const idText = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v || undefined;
  if (
    v &&
    typeof v === 'object' &&
    typeof (v as { toHexString?: unknown }).toHexString === 'function'
  ) {
    return (v as { toHexString: () => string }).toHexString();
  }
  return undefined;
};

export const report = (
  out: FlexReplyOut | undefined,
  doc: Record<string, unknown>,
): void => {
  if (!out) return;
  const id = idText(doc['_id']);
  if (id !== undefined) out.docId = id;
  if (typeof doc['name'] === 'string') out.name = doc['name'];
};
