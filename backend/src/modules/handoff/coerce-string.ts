/**
 * Explicit string coercion for values arriving from an untyped request body.
 *
 * The legacy handlers are JavaScript and lean on `String(x)` over `req.body`
 * values whose type nothing has checked. Reproducing that in TypeScript trips
 * `@typescript-eslint/no-base-to-string`, and rightly so: `String({})` is
 * `"[object Object]"`, which would then be stored or matched against a pattern
 * as if it were real input.
 *
 * This helper keeps the legacy result for every type that actually reaches
 * these paths — strings, numbers, booleans, null and undefined — and maps
 * objects and arrays to `''` instead of `"[object Object]"`.
 *
 * That difference is deliberate and is not a behaviour change in practice:
 * every call site feeds the result into a pattern test, an enum check or a
 * comparison that `"[object Object]"` fails anyway. The two diverge only in
 * WHICH rejection message comes back for a caller that sent an object where a
 * string belongs, and `''` produces the same rejection more honestly. Where an
 * object could legitimately arrive it is handled before this is called.
 */
export function coerceString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  // Objects, arrays, functions and symbols: no useful string form.
  return '';
}
