/**
 * [FEAT-20260901-OBJSCOPE] Normalise a scope column to plain id strings.
 *
 * The backend hands these back in two shapes depending on the endpoint: bare
 * ObjectId strings (`hook_ids`, and categories) or populated documents
 * (`group_providers` on an album, which `object-images.service.ts` populates).
 * The pickers tick by id, so a populated object would match nothing and the
 * form would open with an empty scope — which the next save would then write
 * over the real one.
 *
 * Written once and shared by both object modals; a second copy is exactly how
 * the two forms would drift.
 */
export function toIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (entry === null || entry === undefined) return '';
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object') {
        const o = entry as Record<string, unknown>;
        return String(o.id ?? o._id ?? '');
      }
      return String(entry);
    })
    .filter(Boolean);
}

export default toIds;
