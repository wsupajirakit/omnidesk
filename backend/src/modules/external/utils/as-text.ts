/**
 * Stringify a config-supplied value for the wire.
 *
 * Values pulled out of payload templates, `result_map` paths and stored tool
 * documents are `unknown`, but every consumer here — query strings, form
 * fields, header values, log lines — needs text.
 *
 * This deliberately keeps `String()`'s exact semantics, **including
 * `[object Object]` for a plain object**. Legacy does the same (`String(v)` and
 * `URLSearchParams`, which stringifies identically), and the golden suite
 * compares this service's outbound calls against legacy's. Switching to
 * `JSON.stringify` here would look like a bug fix but would silently change
 * outbound request bodies for any tool whose template yields a nested object —
 * a behaviour change smuggled in under a lint fix.
 *
 * If a template legitimately needs a nested object on the wire, the fix belongs
 * in the endpoint's `request_type`/`payload` config, not here.
 */
export function asText(value: unknown): string {
  return String(value);
}
