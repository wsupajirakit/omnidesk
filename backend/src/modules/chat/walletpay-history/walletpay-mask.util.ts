/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  🔒 THIS FILE IS THE ONLY PLACE MASKING FOR THE WALLETPAY CARD IS DECIDED.   ║
 * ║  ALL MASKING HAPPENS SERVER-SIDE, BEFORE THE RESPONSE IS SENT.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * OWNER'S RULE (16/08/2026, stated twice): the payload that leaves this process
 * must already be masked. A first version blurred some values in the browser
 * instead; that was WRONG and was reverted:
 * client-side blurring still ships the real value over the wire, where it sits
 * in the browser's network tab, in any proxy log, and in a screenshot of either.
 * A value the client has to hide is a value we should never have sent.
 *
 * ⇒ IF YOU ARE ASKED TO CHANGE HOW MUCH IS HIDDEN, CHANGE IT HERE:
 *     · VISIBLE_RATIO        identity + storage values  (currently ~90% hidden)
 *     · URL_VISIBLE_RATIO    whole URLs                 (currently ~80% hidden)
 *     · blurMiddle()         trace handles              (currently ~50% hidden)
 *   The front-end must stay a pure renderer for this feature — it keeps a thin
 *   second pass (`components/member/walletpay/walletpayMask.ts`) as a safety net only.
 *   NEVER move a rule there to "make the UI show more"; that reopens the hole.
 *
 * WHAT IS DELIBERATELY NOT MASKED, and why (do not "fix" these):
 *     · refId        — an admin pastes it into walletpay's own console; it also
 *                      travels in walletpay's public slip-upload link
 *     · statement_id — the deposit row the operator is looking for
 *     · amounts, timestamps, http status, status words — the job needs them
 *
 * SCOPE: this file serves the WalletPay history card ONLY. The handoff chain
 * console has its own redaction and is untouched by anything here.
 *
 * ==== [FEAT-20260816-WALLETPAYCARD] deep id-masking for the WalletPay result card ====
 *
 * WHY: the ticket panel shows an admin the RAW request/response of each walletpay
 * leg. Those bodies are full of identifiers — refId, LINE user id, Mongo ids,
 * provider transaction ids — and the owner's rule is: anything that LOOKS like
 * an id is masked, **no matter what key it sits under**. Masking is applied on
 * the SERVER, before the payload leaves the process, so the browser never
 * receives the full value; the client keeps a thin second pass as a safety net.
 *
 * WHAT IS MASKED — by VALUE SHAPE, never by key name:
 *   · UUID           8-4-4-4-12 hex        → fe601b…2a16e
 *   · LINE user id   'U' + 32 hex          → Ubd88e…94dd7
 *   · Mongo ObjectId 24 hex                → 6a817…afe82
 *   · long opaque token ≥ 24 chars of [A-Za-z0-9_-] with no space
 * ~90% of each value is hidden (see VISIBLE_RATIO below).
 *
 * WHAT IS NEVER TOUCHED — the fields an admin needs to read to do their job:
 *   amounts, dates/timestamps, http status, status/outcome words, messages,
 *   bank names, and any string shorter than the shapes above (e.g. 'walletpay',
 *   'no_match', '400'). Numbers and booleans are returned as-is.
 *
 * SHAPE-BASED, NOT KEY-BASED, ON PURPOSE: a key allowlist rots the moment the
 * upstream renames a field (that is exactly how `ref_id` vs `info.trade_no`
 * bit us), while the shape of a value does not change.
 *
 * SAFETY: pure, no I/O, never throws (a cyclic/oversized object is cut off by
 * MAX_DEPTH rather than blowing the stack). It is used on a READ-ONLY path; no
 * money decision reads its output.
 *
 * TO CHANGE: add a pattern to ID_PATTERNS — every consumer masks more, at once.
 * revert: delete this folder; nothing else imports it.
 */

/* MASK STRENGTH — ~90% of every masked value is hidden and ~10% stays readable,
 * split head/tail so an admin can still correlate two rows by eye without the
 * value being usable. The split is proportional, so it holds for a 36-char id
 * and a 24-char one alike; MIN_KEEP stops a very short value from being reduced
 * to nothing. Changing this ONE number changes the strength for the whole card. */
const VISIBLE_RATIO = 0.1; // 10% visible ⇒ 90% masked
const MIN_KEEP = 2; // never show fewer than 2 chars per side
/** Guards against pathological nesting; real payloads are < 10 deep. */
const MAX_DEPTH = 12;

/* ⚠️ [FIX-20260816-REFIDCLEAR] THE UUID RULE IS DELIBERATELY ABSENT.
 * The owner reversed it on 16/08 after reading a live modal: **refId must NOT be
 * masked**. It is the one value an admin needs verbatim — it is what they paste
 * into walletpay's own console to look the transaction up, and it is not a secret
 * (it travels in the request URL walletpay itself publishes as a slip-upload link).
 * Masking it made the modal useless for the job it exists for.
 *
 * What REMAINS masked here is the identity/credential family: the customer's
 * LINE id, our internal Mongo ids, and long opaque tokens.
 * TO CHANGE BACK: add the UUID pattern to this list AND to EMBEDDED_ID_PATTERNS
 * below — both, or a refId inside a URL still prints in full. */
const ID_PATTERNS: RegExp[] = [
  /^U[0-9a-f]{32}$/i, // LINE user id
  /^[0-9a-f]{24}$/i, // Mongo ObjectId
  /^[A-Za-z0-9_-]{24,}$/, // long opaque token (JWT-ish, evidence refs)
];

/* [FIX-20260816-REFIDCLEAR] refId is a UUID and must print in full. Dropping the
 * UUID rule from ID_PATTERNS was not enough on its own: the generic "long opaque
 * token" rule matched it anyway (a dashless comparison is not what saves it — the
 * token rule allows `-`). So a UUID is excluded EXPLICITLY here, before any rule
 * runs. Everything else keeps its behaviour. */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12,}$/i;

/**
 * [FIX-20260816-TRACEBLUR] blur the MIDDLE of a value, keeping both ends.
 *
 * Used for the three trace handles (`job_ref`, `run_id`, `result_id`). They are
 * our own ids and an operator compares them by eye, so the ends must stay — but
 * the owner's rule stands: the response itself must never carry the full value.
 * Blurring on the client would leave the real value in the network payload, so
 * it happens HERE, before answering.
 *
 * @param visibleRatio how much stays readable (0.5 ⇒ ~50% blurred)
 */
export function blurMiddle(value: string, visibleRatio = 0.5): string {
  const v = String(value ?? '');
  const keep = Math.max(4, Math.floor(v.length * visibleRatio));
  if (v.length <= keep + 1) return v;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/** True when the string looks like an identifier by SHAPE alone. */
export function looksLikeId(value: string): boolean {
  const v = value.trim();
  if (v.length < 24) return false; // shorter than every shape above
  if (UUID_SHAPE.test(v)) return false; // refId — readable on purpose
  return ID_PATTERNS.some((re) => re.test(v));
}

/**
 * Hide ~90% of an id: keep a proportional head + tail, ellipsis in between.
 * e.g. a 33-char LINE id keeps 2 head + 2 tail (≈10%).
 * Values shorter than the keep budget are returned unchanged.
 */
export function maskId(value: string): string {
  const v = String(value);
  const keep = Math.max(MIN_KEEP * 2, Math.floor(v.length * VISIBLE_RATIO));
  if (v.length <= keep + 1) return v;
  const head = Math.max(MIN_KEEP, Math.ceil(keep / 2));
  const tail = Math.max(MIN_KEEP, keep - head);
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/* ==== ids EMBEDDED inside a longer string ====
 * Caught by test (M3): the walletpay request URL is
 * `https://host/api/v1/public/payin/<uuid>/slip` — the whole string is not an
 * id, so a whole-value check let the refId through verbatim. Anything that
 * carries an id INSIDE it (urls, messages, paths, query strings) is scrubbed
 * substring-by-substring here.
 * ⚠️ Deliberately narrower than `ID_PATTERNS`: only UUID / LINE id / 24-hex are
 * matched inside free text, because the generic "long token" rule would eat
 * ordinary URL segments and make the log unreadable. */
const EMBEDDED_ID_PATTERNS: RegExp[] = [
  /* [FIX-20260816-REFIDCLEAR] no UUID rule here either — see ID_PATTERNS above.
     A refId inside the request URL stays readable on purpose. */
  /\bU[0-9a-f]{32}\b/gi, // LINE user id
  /\b[0-9a-f]{24}\b/gi, // Mongo ObjectId
  /* [FIX-20260816-BLURSTORAGE] the storage leak the owner spotted in the modal:
     walletpay answers with `path`/`url` carrying a 32-hex object name AND a 64-hex
     `sig=` query token. Neither matched the rules above (24-hex is bounded by
     \b, and the whole-string rules never fire inside a URL), so both printed in
     full. Bounded generic hex ≥ 16 covers object names, signatures and any
     future digest without touching short words. */
  /\b[0-9a-f]{16,}\b/gi,
];

/* [FIX-20260816-BLURURL] Owner 16/08: URLs themselves are blurred (~80%), not
 * just the ids inside them. A full endpoint path tells a reader which host and
 * route we call and carries the storage location of a customer's slip image —
 * neither belongs on a support screen.
 *
 * WHAT SURVIVES, on purpose: the scheme+host head and the tail, so an admin can
 * still tell "this went to walletpay" / "this is an s3 slip link" apart at a glance.
 * The full value is in the handoff log for whoever genuinely needs it.
 * ⚠️ Applied AFTER the id rules, so a refId inside a URL is already readable —
 * the URL blur then covers the surrounding path anyway; refId stays visible as
 * its own field on the row and in the trace strip. */
const URL_SHAPE = /\b(?:https?:\/\/|s3:|slip-images\/)[^\s"']{12,}/gi;
const URL_VISIBLE_RATIO = 0.2; // 20% visible ⇒ ~80% blurred

function maskUrl(url: string): string {
  const keep = Math.max(8, Math.floor(url.length * URL_VISIBLE_RATIO));
  if (url.length <= keep + 1) return url;
  const head = Math.ceil(keep * 0.7); // scheme+host is the useful half
  const tail = Math.max(3, keep - head);
  return `${url.slice(0, head)}…${url.slice(-tail)}`;
}

function maskEmbeddedIds(text: string): string {
  let out = text;
  for (const re of EMBEDDED_ID_PATTERNS) {
    out = out.replace(re, (m) => maskId(m));
  }
  out = out.replace(URL_SHAPE, (m) => maskUrl(m));
  return out;
}

/**
 * Walk any JSON-ish value and mask every id-shaped STRING it contains —
 * whole values AND ids embedded inside longer strings.
 * Arrays/objects are rebuilt (the input is never mutated).
 */
export function maskIdsDeep<T>(input: T, depth = 0): T {
  if (depth > MAX_DEPTH) return '[…]' as unknown as T;
  if (typeof input === 'string') {
    return (looksLikeId(input)
      ? maskId(input)
      : maskEmbeddedIds(input)) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((v) => maskIdsDeep(v, depth + 1)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src))
      out[k] = maskIdsDeep(v, depth + 1);
    return out as unknown as T;
  }
  return input; // numbers, booleans, null, undefined — untouched
}
