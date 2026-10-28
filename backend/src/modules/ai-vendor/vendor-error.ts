/**
 * [FEAT-20260908-AIVENDORERR] Turning a thrown vendor error into a result, once.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 6
 * ===========================================================================
 * Every transport ends the same way: catch whatever axios threw, dig the status
 * and the body out of it, and return a result that says "no text, here is what
 * went wrong". **All six lanes across both vendors produced the identical
 * mapping** — five of them character for character, and `deepseek-summary` only
 * differs by hoisting the message into a variable so its log line can reuse it.
 * The value is the same in all six.
 *
 * `dig` — the `a?.b?.c`-over-`unknown` walk this mapping needs — was declared
 * **eight times** in this repo. Seven of those are AI transports; the eighth is
 * `reply-dyntag.ts`, which is not a vendor file and is left alone.
 *
 * 🔴 THE MAPPING IS TRANSCRIBED, NOT REDESIGNED. Three details look like they
 *    could be tidied and must not be:
 *
 *    · `httpStatus: 0` when the error carries no numeric status. Zero is the
 *      agreed "never reached a response" value and callers branch on it. `null`
 *      or `undefined` would read as a missing field instead of a known state.
 *    · `raw: data ?? null` — null, not undefined. It is written into audit rows,
 *      and `undefined` disappears from JSON while `null` survives as evidence
 *      that the call failed with no body.
 *    · `errorMessage` prefers a STRING body verbatim, else `JSON.stringify` of
 *      the body, else the Error's own message, else the literal `'error'`. The
 *      final `?? 'error'` matters: `JSON.stringify(undefined)` returns
 *      `undefined` (the value, not a string), which would put a non-string into
 *      a field every caller treats as text.
 *
 * ⚠️ WHAT THIS DOES NOT DO. It does not log. The six lanes log differently on
 *    purpose — different prefixes, and two of them do not log at all — so the
 *    log line stays with its lane and only the VALUE is shared. A logger
 *    parameter here would quietly give the silent lanes a voice.
 *
 * ⚠️ It also does not classify retryable vs fatal. Both vendors publish such a
 *    taxonomy (429/500/503 retryable; 400/401/402/404/422 not) and adopting it
 *    is a real improvement — but it CHANGES what happens after a failure, which
 *    is a behaviour decision and not part of moving a mapping.
 *
 * revert: delete this file and restore each transport's own `dig` + catch body.
 * They were identical, so the restore is mechanical.
 */

/** The shape every transport returns when the vendor answered. */
export interface VendorSuccess {
  rawText: string | undefined;
  httpStatus: number;
  raw: unknown;
  errorMessage: null;
}

/** The shape every transport returns when the vendor call did not produce text. */
export interface VendorFailure {
  rawText: undefined;
  httpStatus: number;
  raw: unknown;
  errorMessage: string;
}

/**
 * `a?.b?.c` over a value typed `unknown`.
 *
 * ⚠️ TRANSCRIBED from the seven identical copies (originally from
 * `rag-engine.service.ts:1468`). It returns `undefined` rather than throwing at
 * any depth, which is what lets the mapping below read an axios error whose
 * shape is not guaranteed.
 */
export function dig(o: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (cur, k) =>
      typeof cur === 'object' && cur !== null
        ? (cur as Record<string, unknown>)[k]
        : undefined,
    o,
  );
}

/**
 * The message a caller logs and stores. Split out because `deepseek-summary`
 * needs the same string for its log line and its result field, and computing it
 * twice is how the two drift apart.
 */
export function vendorErrorMessage(err: unknown): string {
  const data = dig(err, 'response', 'data');
  return typeof data === 'string'
    ? data
    : JSON.stringify(data ?? (err as Error)?.message ?? 'error');
}

/** Thrown vendor error → the result every transport already returned. */
export function vendorFailure(err: unknown): VendorFailure {
  const status = dig(err, 'response', 'status');
  const data = dig(err, 'response', 'data');
  return {
    rawText: undefined,
    httpStatus: typeof status === 'number' ? status : 0,
    raw: data ?? null,
    errorMessage: vendorErrorMessage(err),
  };
}

/**
 * Vendor response → the result every transport already returned on success.
 *
 * 🔴 ALL SIX LANES BUILT THIS IDENTICALLY — hashing the block gave one digest
 *    across both vendors. Two details are transcribed, not chosen:
 *
 *    · `httpStatus: … : 200`. The fallback is **200**, not 0, and that asymmetry
 *      with `vendorFailure` is correct: reaching this function means the vendor
 *      ANSWERED, so a missing or non-numeric status field means "answered, status not
 *      reported" — the success default. `vendorFailure` uses 0 for the opposite
 *      reason: it never reached a response.
 *    · `errorMessage: null`, not `undefined`. Every interpreter gates on
 *      `rawText === undefined && errorMessage !== null`, so an `undefined` here
 *      would make a SUCCESSFUL empty answer indistinguishable from a failure.
 *
 * ⚠️ `rawText` is read by the CALLER and passed in, because the two vendors walk
 *    different shapes (`candidates[…]` vs `choices[…]`). The reader stays with
 *    its vendor; only the envelope is shared.
 */
export function vendorSuccess(
  res: { status?: unknown; data?: unknown },
  rawText: string | undefined,
): VendorSuccess {
  return {
    rawText,
    httpStatus: typeof res.status === 'number' ? res.status : 200,
    raw: res.data,
    errorMessage: null,
  };
}
