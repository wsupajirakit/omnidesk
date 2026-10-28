/**
 * Coercion helpers for request bodies typed as `unknown`.
 *
 * The controllers in this module take untyped bodies on purpose — see the note
 * on the DTO convention in check-list.md: the legacy handlers accept whatever
 * arrives and normalise it themselves, so declaring a validated DTO would
 * reject bodies legacy accepts and break parity on the very first request.
 *
 * The cost of that choice is that `String(value)` on an `unknown` renders an
 * object as `"[object Object]"` — a value that then gets written to the
 * database and compared against ObjectIds forever, matching nothing. ESLint's
 * `no-base-to-string` flags exactly this. These helpers make the intent
 * explicit rather than silencing the rule.
 */

/**
 * `String(value)` with the object case made explicit.
 *
 * ⚠️ This deliberately reproduces JavaScript's `"[object Object]"` for a plain
 * object rather than "improving" it to `''`. Legacy calls bare `String()` at
 * every one of these sites, so a body sending `{"name": {}}` is stored there as
 * the literal text `[object Object]`. Returning `''` instead would make this
 * service answer 400 where legacy answers 201 — a parity break on nonsense
 * input, which is still a parity break the golden diff would report.
 *
 * The rule this satisfies is `no-base-to-string`, whose real point is that an
 * accidental stringification is invisible. Here it is intentional and named.
 */
export function toScalarString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(toScalarString).join(',');
  if (typeof value === 'object') {
    // Respect a custom toString (ObjectId, Date, Buffer) before falling back to
    // the Object.prototype rendering legacy would produce.
    const proto = Object.getPrototypeOf(value) as object | null;
    const own = (value as { toString?: unknown }).toString;
    if (typeof own === 'function' && own !== Object.prototype.toString) {
      return (own as () => string).call(value);
    }
    void proto;
    return '[object Object]';
  }
  return '';
}

/** As above, trimmed — the form used for ids and names. */
export function toTrimmedString(value: unknown): string {
  return toScalarString(value).trim();
}

/**
 * An id rendered for comparison: ObjectId instances stringify to their hex, and
 * a populated subdocument yields its `_id`. Everything else falls back to
 * `toScalarString`, so an unexpected shape compares as `''` rather than
 * silently matching nothing under a misleading value.
 */
export function toIdString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as { _id?: unknown; toHexString?: unknown };
    if (typeof record.toHexString === 'function') {
      return (record.toHexString as () => string)();
    }
    if (record._id !== undefined) return toIdString(record._id);
    return '';
  }
  return toScalarString(value);
}
