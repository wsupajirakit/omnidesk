/**
 * ==== [FEAT-20260902-SLIPPROVIDER] the slip-verification seam, named ========
 *
 * WHAT: the contract between `SlipFlowService` and whoever verifies a slip.
 * Today there is exactly one implementation (`swiftcheck/swiftcheck.provider.ts`) and the
 * behaviour is unchanged; `docs/slip-spec.md` §5.4 is the plan this opens the
 * door for.
 *
 * ── WHY IT IS SPLIT INTO buildRequest / send, AND NOT ONE `verify()` ────────
 *
 * 🔴 CORRECTION, 2026-09-02. An earlier version of this note claimed the split
 * was FORCED because `verifySlip`'s `catch` reads `verifyPayload` to write
 * `raw_request` on the error row. **That is not true and the claim is now
 * removed.** `raw_request` is written at exactly three places and all three sit
 * after a successful HTTP response — the webhook log, VARIANT 1 and VARIANT 2.
 * VARIANT 3, the throw path, writes `raw_response` and `metadata` and has never
 * carried `raw_request` at all.
 *
 * ⚠️ DO NOT "RESTORE" `raw_request` ONTO THE `ERR_` ROW while wiring this. It
 * was never there. Adding it is a silent schema change on the failure path of
 * the money flow, and the inbound golden cannot catch it because that spec
 * strips `raw_request` before comparing — which is why an explicit assertion
 * that VARIANT 3 has no `raw_request` now lives in
 * `z-test/unit/slip-inbound-baseline.spec.ts`.
 *
 * THE HONEST REASONS FOR THE SPLIT, none of them "the code forces it":
 *   1. `buildRequest` is pure, so the request can be compared against the
 *      recorded golden with no I/O and BEFORE anything is wired — which is how
 *      the move was proved exact rather than argued to be
 *      (`z-test/unit/slip-provider-swiftcheck-move.spec.ts`).
 *   2. It keeps `send` small enough to audit at a glance for the one thing it
 *      must not do: catch.
 *   3. `verifyPayload` stays a plain local in the caller, so the three
 *      `raw_request` sites keep reading the same object they read today.
 * A single `verify()` returning `{status, data, wireRequest}` would also work.
 * This shape was chosen for the proof, not because the alternative breaks.
 *
 * `send` keeps the throw untouched. The caller reads `error.response` and
 * `error.message` off whatever axios raised; wrapping that in a provider error
 * would change both, and with them `slipVerifyResult` and `slipCondition`. So
 * `send` deliberately does NOT catch — the original rejection travels, exactly
 * as the inline call did.
 *
 * ⚠️ CALL `buildRequest` ONCE. Wire it as
 * `const request = p.buildRequest(...); verifyPayload = request.body; await p.send(request);`
 * Building twice is harmless for Swiftcheck, but a provider that stamps a nonce or
 * a timestamp would then record a different request than the one it sent.
 *
 * ── WHAT A SECOND PROVIDER GETS TO DECIDE ───────────────────────────────────
 * The path, the headers, the body and the timeout.
 *
 * 🔴 NOT THE HOST, NOT YET. `baseUrl` is passed in by the caller and the caller
 * hardcodes Swiftcheck's (`swiftcheckBaseUrl()`, from `SWIFTCHECK_API_BASE_URL`). A second
 * provider registered today would have its path appended to **Swiftcheck's host**.
 * Three more Swiftcheck-isms also sit in the caller, outside this seam: the webhook
 * log's `channel: 'swiftcheck_api'` / `action_type` / `endpoint` literals, and the
 * success test reading Swiftcheck's `data.success`. The seam is real but partial,
 * and closing it is part of wiring a second provider — not something the port can
 * do on its own. That is the whole point — SlipGuard addresses a branch in the path,
 * authenticates with `x-authorization` rather than a bearer token, names the
 * image field `files`, and folds our two boolean flags into its single `log`
 * (measured; `docs/slip-spec.md` §6.3). None of that can be expressed by
 * reshaping a Swiftcheck payload after the fact.
 *
 * ══ 🔴 THE DATE FIELD IS A TRAP, AND IT IS MEASURED ═════════════════════════
 * `data.rawSlip.date` is not a free-form timestamp. It is parsed by
 * `parseBangkokSlipDateMs` in `slip-flex.handler.ts`, which matches
 * `YYYY-MM-DD[ T]HH:mm[:ss]` **anchored at the start only** and then rebuilds the
 * string with a HARDCODED `+07:00`. Any trailing offset is discarded — including
 * a `Z`.
 *
 * SlipGuard's `transTimestamp` is UTC-suffixed. Passing it straight through:
 *
 *     '2026-08-12T10:08:36.000Z'  ->  parsed as 2026-08-12T03:08:36Z   (7h early)
 *     '2026-08-12T17:08:36+07:00' ->  parsed as 2026-08-12T10:08:36Z   (correct)
 *
 * Both strings are the SAME INSTANT. Run against the value actually captured
 * from the live API: **7.0 hours off.** The slip therefore looks seven hours
 * OLDER than it is, so with any `slip_check_out_of_time` below seven hours
 * **every slip from that provider is flagged out-of-time** and answered with the
 * expired-slip card. Nothing errors; the check simply always fires.
 *
 * ⇒ An adapter MUST emit Bangkok wall time with an explicit `+07:00`, or a bare
 * `YYYY-MM-DD HH:mm:ss` already in Bangkok time. For SlipGuard that means composing
 * `transDate` + `transTime` (which are already local) rather than forwarding
 * `transTimestamp`.
 *
 * ⚠️ And a value the parser cannot match at all is worse in a quieter way: it
 * logs and leaves `violationDetected` false, so the out-of-time check is silently
 * skipped for every slip. No error, no card, no trace beyond one log line.
 *
 * 🔴 [RULE-20260903-DATEPERVENDOR] THE DATE IS DIFFERENT FOR EVERY VENDOR. CHECK
 * IT PER PROVIDER — AGAINST THAT VENDOR'S OWN DOC **AND** AGAINST A REAL
 * RESPONSE. Do not carry an assumption over from the last provider you wired.
 *
 * Measured across five vendor APIs on 03/09, and they do not agree:
 *   Swiftcheck    `rawSlip.date`      — the shape the parser was written for
 *   QuickSlip   `date`, ISO `+07:00` — safe, the offset is explicit and local
 *   SlipGuard     `transTimestamp`, UTC `Z` — 7 hours early through this parser;
 *              its `transDate` + `transTime` are already local and are what an
 *              adapter should compose instead
 *   HaveSlip   `createdAt` / `completedAt`, ISO **UTC `Z`** — same trap
 *   Slip2Go    not established — its doc is a PDF and the field was not read
 *
 * ⇒ So this is NOT "the SlipGuard quirk". It is a property of every vendor that
 * answers UTC, and two of the five do. Assuming a new vendor behaves like the
 * last one is exactly how a whole hook starts getting expired-slip cards for
 * perfectly good slips, with nothing in the logs to say why.
 *
 * ⇒ WHEN WIRING A PROVIDER, both checks, in this order:
 *   1. read that vendor's OWN documentation for the timestamp field and its
 *      timezone — the field name differs as much as the format does
 *   2. then verify against a REAL captured response, because docs are written
 *      once and APIs drift. Every fact in the list above came from a measurement
 *      or a live capture, not from reading alone
 *   3. the fix belongs in that provider's `normaliseResponse` — emit Bangkok
 *      wall time with an explicit `+07:00`, or a bare `YYYY-MM-DD HH:mm:ss`
 *      already in Bangkok time. Never "fix" the shared parser for one vendor
 *
 * แต่ละเจ้าไม่เหมือนกัน · ต้องเช็ค doc ของเจ้านั้น **และ** response จริงตอนทำ ห้ามยกของเจ้าเก่ามาใช้
 *
 * ⚠️ WHAT A PROVIDER MUST NOT DO: change what the caller does with the answer.
 * `SlipFlowService` maps the reply onto the `slip_verifications` row through a
 * chain of fallbacks that IS the contract (pinned by
 * `z-test/unit/slip-inbound-baseline.spec.ts`). A provider whose reply does not
 * already fit that shape has to fold it there, inside its own module.
 *
 * revert: delete `providers/`, inline `buildRequest`'s body back into
 * `verifySlip` and call `axios.post` directly. The two baseline specs prove the
 * revert is exact.
 */

/** What the flow knows, before any provider-specific shaping. */
export interface SlipVerifyInput {
  /**
   * The stored slip image, already read and encoded by the caller.
   *
   * ✅ [POLICY-20260903-BASE64FIRST] BASE64 IS THE FORM WE SEND, FOR EVERY
   * VENDOR THAT ACCEPTS IT. Owner's direction, 03/09. It is one read of the
   * stored file, no temp file, no multipart assembly, no public URL to expose,
   * and — the reason it matters here — `redactImageField` can strip a string
   * before the request is persisted. Bytes or a URL cannot be redacted the same
   * way.
   *
   * MEASURED ACROSS FIVE VENDORS, all of them take it:
   *   Swiftcheck    `base64`                 · SlipGuard   `files` (base64 confirmed live)
   *   QuickSlip   base64 among its inputs  · HaveSlip `imageUrl` as `data:…;base64,…`
   *   Slip2Go    its QR endpoint takes a payload string; the image endpoint exists
   *
   * ⇒ The PROVIDER decides the wire form. It receives this one string and names
   * the field, wraps it in a data URL, or ignores it — whatever its vendor wants.
   * That is why nothing here is vendor-shaped.
   *
   * 🔴 THE PIPE, if a vendor ever needs something else: add an OPTIONAL sibling
   * to this interface — a file path, raw bytes, a fetchable URL — and populate it
   * in the caller alongside this one. Optional means every existing provider
   * keeps compiling and keeps behaving identically, and the new provider reads
   * the field it needs. Do NOT replace this string or make it optional: the four
   * providers above would all have to change for the sake of one.
   * ⚠️ And whatever is added must answer redaction first. A path or a URL in
   * `raw_request` is a pointer to a customer's slip, which is the same leak in a
   * different shape — see `redact-image.ts` `[FIX-20260903-NESTEDIMAGEFIELD]`.
   * ใช้ base64 เป็นหลักทุกเจ้าที่รับ · เจ้าไหนต้องการรูปแบบอื่นค่อยเติม field optional ข้าง ๆ
   * ของเดิมไม่ต้องแก้สักตัว · แต่ต้องตอบเรื่อง redact ให้ได้ก่อน
   */
  imageBase64: string;
  /** Ask the provider to flag a slip it has seen before. */
  checkDuplicate: boolean;
  /** Ask the provider to compare the receiver against the account it holds. */
  matchAccount: boolean;
  /**
   * DECRYPTED at the call site. Providers never touch `CryptoService` — the key
   * reaches them as plaintext and is never logged, exactly as before.
   */
  apiKey: string;
  /** Provider base URL, resolved from config by the caller. */
  baseUrl: string;
  /**
   * ==== [FEAT-20260903-VENDORBRANCH] the hook's sub-account at the vendor =======
   *
   * OPTIONAL, exactly as the note on `imageBase64` prescribes: a sibling added
   * for one vendor, so every existing provider keeps compiling and keeps
   * behaving identically. Swiftcheck never reads it.
   *
   * WHAT IT IS. Some vendors do not identify the merchant by the API key alone —
   * the account is part of the ENDPOINT. SlipGuard posts to
   * `…/api/line/apikey/<BRANCH_ID>`, so the same hook needs both a key and a branch
   * number, and the branch is per-hook data that only the hook can carry. It
   * arrives from `hook.slip_verify_branch`.
   *
   * 🔴 MEASURED, AND IT IS NOT WHAT ONE WOULD ASSUME: separating the key and the
   * branch **isolates nothing** at SlipGuard. Two different branches with two
   * different keys share one duplicate history and one quota pool — a slip first
   * seen by branch A comes back `1012` on branch B, quoting branch A's timestamp,
   * and both branches report the same remaining quota. So this field selects
   * which account is billed and checked, NOT a private namespace.
   * แยก key แยก branch ไม่ได้แยกอะไรเลย — ประวัติสลิปซ้ำและโควตาเป็นก้อนเดียวกัน
   *
   * ⚠️ NOT A SECRET. It is an account number, not a credential, and it must not
   * join the encrypted-field lists — but see the clone note on the schema Prop:
   * it travels with the slip tab while the KEY is opt-in, so a half-ticked clone
   * can pair one hook's branch with another hook's key. That combination fails
   * closed at the vendor (`1002`), which is the safe direction, not a silent one.
   */
  branchId?: string;
}

/** Everything that goes on the wire, decided before anything is sent. */
export interface SlipVerifyRequest {
  url: string;
  headers: Record<string, string>;
  /**
   * The request body. The caller records this as `raw_request` (with the image
   * redacted) at three sites, **all of them after a successful HTTP response** —
   * the webhook log, VARIANT 1 and VARIANT 2. The throw path records none. It
   * must be the object that is actually sent, not a copy or a summary.
   */
  body: Record<string, unknown>;
  timeoutMs: number;
  /**
   * [FEAT-20260903-PROVIDEROWNSITSNAMES] The path portion, for the webhook log's
   * `endpoint` column. The flow used to write `'/verify/bank'` as a literal —
   * Swiftcheck's path, recorded against every provider's call. Building it here
   * keeps the log honest for free, because the provider already had to know it
   * to build `url`.
   */
  endpoint: string;
  /**
   * 🔴 Which key in `body` holds the image, so the caller can redact it without
   * knowing the provider.
   *
   * The caller records `raw_request` as `{ ...body, base64: '[BINARY_DATA]' }`
   * at three sites today — with the key `base64` written as a literal. That is
   * correct for Swiftcheck and WRONG for anything else: SlipGuard names the field
   * `files`, so the same three lines would add a phantom `base64` key **and
   * leave the entire base64 image sitting in `webhook_logs.raw_request` and
   * `slip_verifications.raw_request`**. A slip image in the logs is both a data
   * leak and a storage problem, and the existing guard
   * (`slip-outbound-baseline.spec.ts`) only checks Swiftcheck's key name, so it
   * would not fire.
   *
   * ⚠️ Any provider added here MUST set this. **The caller consumes it** — the
   * three `raw_request` sites call `redactImageField(body, imageField)`, and the
   * literal `base64` is gone from them. (An earlier version of this note said the
   * caller still used the literal; that stopped being true when it was wired.)
   */
  imageField: string;
}

/** The provider's answer, reduced to what the flow reads. */
export interface SlipVerifyResponse {
  /** Recorded as `http_status` on the webhook log. */
  status: number;
  /** The provider's body, verbatim — `slipVerifyResult` and `raw_response`. */
  data: unknown;
}

/**
 * 🔴 [GAP-20260903-NORESPONSESEAM] WHAT THIS PORT DOES NOT COVER — read before
 * planning provider two or three. Recorded 03/09 after auditing the seam against
 * the question "if there were a THIRD provider, is everything ready?".
 *
 * THE OUTBOUND HALF IS N-READY. `name`, `buildRequest` and `send` are per
 * provider; the timeout lives in the provider file; `imageField` names the key
 * redaction strips; the registry is a map and `providerFor` resolves by name.
 * Adding a tenth provider changes one line of registry and adds one file.
 *
 * THE INBOUND HALF IS STILL SWIFTCHECK-ONLY, AND THIS PORT HAS NO SEAM FOR IT.
 * `send` returns the body VERBATIM, and everything downstream reads Swiftcheck's
 * vocabulary and Swiftcheck's tree directly:
 *   · `slip-flex.handler.ts` branches on the STRING codes `'VALIDATION_ERROR'`,
 *     `'SLIP_NOT_FOUND'`, `'SLIP_PENDING'`, and on `data.matchedAccount`
 *   · `slip-flow.service.ts` builds the slip row out of
 *     `data.sender.account.bank.account`, `data.sender.bank.short`, `transRef`…
 *   · `payment-runner.service.ts` forwards the whole envelope to Shop-API
 *     ([DECISION-20260903-VERIFYFEEDSPAYMENT])
 *
 * ⇒ A SECOND PROVIDER NEEDS A FOURTH MEMBER HERE — a pure mapper from its own
 * envelope to the shape those three readers already expect. That is where the
 * `1014` fold ([DECISION-20260903-FOLD1014]) belongs: in the provider, not in
 * the flow. Without it, adding a provider means editing the flow, which is
 * exactly what this port was created to stop.
 *
 * ⚠️ AND ONE THING THE 03/09 DECISIONS DID NOT SETTLE: the error-code table was
 * written as "ONE table `code -> verdict`". That is right for one vendor and
 * WRONG for three — vendors do not share a numbering space, and two of them can
 * both define `1010` meaning different things. The table must be **per provider**
 * (each mapper owns its own), with the flow seeing only the shared verdicts.
 * ตารางโค้ดต้องเป็นของ provider แต่ละตัว ไม่ใช่ตารางกลางตัวเดียว
 *
 * 📄 REF: `docs/slip-spec.md` §10.
 */
export interface SlipProvider {
  /* ==== [FEAT-20260903-PROVIDEROWNSITSNAMES] four facts the FLOW used to hold ==
   *
   * Each of the four below replaced a Swiftcheck literal sitting in
   * `slip-flow.service.ts`. They are not decoration: with them in the flow, a
   * second provider's calls would have been logged as Swiftcheck's channel, against
   * Swiftcheck's path, judged by Swiftcheck's success field, and sent to Swiftcheck's
   * HOST — the last one silently, because a relative path appended to the wrong
   * base still forms a valid URL.
   *
   * The rule they follow is the owner's: a vendor's facts live in the vendor's
   * own file. Adding a provider means writing them once, next to its request
   * builder, and touching nothing in the flow. ข้อเท็จจริงของ vendor อยู่ในไฟล์ของ vendor
   */

  /**
   * The host used when no override is configured. Swiftcheck's default lived in the
   * FLOW as a module const, which meant a second provider registered today would
   * have had its path appended to Swiftcheck's host and would have called the wrong
   * company with a real slip image.
   */
  readonly defaultBaseUrl: string;

  /**
   * ==== [FEAT-20260903-BASEURLPERPROVIDER] which deployment override is MINE ===
   *
   * The field on the integration config that may replace `defaultBaseUrl` for
   * THIS vendor — declared here, so the flow never has to name a vendor to
   * resolve a host. Omit it when the vendor has no override, which is the
   * normal case.
   *
   * 🔴 THE BUG THIS REMOVES. `slip-flow.service.ts` used to answer
   * `swiftcheckApiBaseUrl || provider.defaultBaseUrl` — one Swiftcheck-named env,
   * applied to EVERY provider. On any deployment that sets `SWIFTCHECK_API_BASE_URL`
   * a second provider would have had its own path appended to **Swiftcheck's host**:
   * a customer's slip image and that vendor's API key posted to the wrong
   * company, with no error, because the URL is still syntactically valid. The
   * `defaultBaseUrl` half of this was fixed when providers were split out; the
   * OVERRIDE half kept Swiftcheck's name and was not.
   *
   * ⚠️ OPTIONAL ON PURPOSE, AND THAT IS THE ANTI-DEBT RULE. Requiring it would
   * push every new vendor to invent an env var so it had something to declare,
   * and a declared env nobody sets is the exact debt `[FIX-20260829-STRIKEENVDEAD]`
   * had to be undone in production. A provider with no entry uses its own host —
   * which is the honest default, since the host is already its own fact.
   *
   * ⚠️ IT IS A KEY NAME, NOT A VALUE. Providers never read config: the flow is
   * the only thing that can, and `resolveBaseUrl` reads exactly the one field
   * this names. The union type means adding the next one is a deliberate edit the
   * compiler checks, not a string that can quietly miss.
   * registry เป็นตัวจริงตัวเดียว · เจ้าไหนรับ override ก็ประกาศเอง · flow ไม่ต้องรู้จักใครเลย
   */
  readonly baseUrlConfigKey?: 'swiftcheckApiBaseUrl';

  /** `webhook_logs.channel` for this provider's calls. */
  readonly logChannel: string;

  /** `webhook_logs.action_type` for this provider's calls. */
  readonly logAction: string;

  /**
   * Did this reply mean success? Read for the log's `status` column only — the
   * card routing has its own reading of the body. Vendors disagree on this:
   * Swiftcheck puts a boolean at `data.success`, and SlipGuard has been measured
   * answering `data.success === true` INSIDE an error envelope, so a shared
   * `data.success` test would record its failures as successes.
   * ⚠️ Must be TOTAL — anything unrecognised is not a success, never a throw.
   */
  isSuccess(data: unknown): boolean;

  /** Identifies the provider. Written onto the slip row as the provenance stamp
   *  ([FEAT-20260903-SLIPPROVSTAMP]) and available for log lines. */
  readonly name: string;

  /** Pure. Shapes the request without sending it. */
  buildRequest(input: SlipVerifyInput): SlipVerifyRequest;

  /**
   * Performs the request.
   * ⚠️ MUST NOT swallow or wrap a transport failure — the caller's `catch`
   * reads `error.response` and `error.message` off the original rejection.
   */
  send(request: SlipVerifyRequest): Promise<SlipVerifyResponse>;

  /**
   * ==== [FEAT-20260903-RESPONSESEAM] the provider's own reply, translated =====
   *
   * Pure. Takes whatever THIS provider answered and returns the envelope the
   * flow reads. Called immediately after `send`, so nothing downstream ever sees
   * a vendor's private vocabulary.
   *
   * 🔴 WHY IT EXISTS AS A PORT MEMBER AND NOT AS A TABLE SOMEWHERE CENTRAL.
   * Owner's rule, 03/09: **a future vendor's shape cannot be predicted, so do not
   * try — leave a pipe, wrap it, and split it per provider. Never hardcode.**
   * Two things forced this and neither can be known in advance:
   *
   *   · ERROR CODES. Vendors do not share a numbering space. Swiftcheck answers
   *     STRINGS (`SLIP_PENDING`), SlipGuard answers NUMBERS (`1010`), and a third
   *     could nest them, or use HTTP status alone. A single central table would
   *     have to be re-keyed for each one, and two vendors defining `1010`
   *     differently would collide with no way to tell them apart. Each provider
   *     owns its own table, inside its own file.
   *   · ENVELOPE SHAPE. The row builder and the Shop-API hand-off read a tree
   *     (`sender.account.bank.account`, `transRef`, …). That tree is Swiftcheck's.
   *     A provider that answers a flat object, or names the same fact
   *     differently, translates HERE — it does not ask the flow to learn a
   *     second shape.
   *
   * ⇒ THE CONTRACT: input is anything this provider can answer; output is the
   * shared envelope. Implementations must be TOTAL — an unrecognised shape maps
   * to something the flow already handles, never to a throw, because this runs on
   * a live conversation.
   *
   * ⚠️ THE HALF THIS DOES NOT COVER YET, stated so nobody assumes it does: the
   * CATCH path. A provider that reports a business outcome as an HTTP error —
   * SlipGuard with `log:true` returns 400 for a wrong receiver, code `1014` — lands
   * in the caller's `catch`, which is not routed through here. Folding `1014`
   * into the success shape ([DECISION-20260903-FOLD1014]) therefore needs this
   * member to be reachable from the error path too. Swiftcheck never needs it, so
   * that half is deliberately unbuilt rather than guessed at.
   *
   * Swiftcheck's implementation is the IDENTITY: its shape is the shared shape,
   * because the flow was written against it. That is not a placeholder — it is
   * the honest statement of which vendor's vocabulary became the canonical one.
   * รูปของ vendor ในอนาคตเดาไม่ได้ ⇒ ห่อไว้ที่ provider แต่ละตัว ห้าม hardcode ใน flow
   */
  normaliseResponse(raw: SlipVerifyResponse): SlipVerifyResponse;

  /**
   * ==== [FEAT-20260903-CATCHSEAM] the other half — a rejection this vendor ====
   * ==== means as an ANSWER, not as a failure ==================================
   *
   * Pure. Given whatever `send` rejected with, decide whether THIS vendor was
   * actually answering. Return the reply it was making, or `null` when the
   * rejection is a real failure.
   *
   * 🔴 WHY IT HAD TO EXIST. `normaliseResponse` covers the success path only, and
   * some vendors report a business verdict as an HTTP error. SlipGuard under
   * `log:true` answers **400** for a wrong receiver (`1014`) and for a duplicate
   * (`1012`) — while still returning the whole slip in `data`. axios throws on
   * 4xx, so without this member that reply lands in the flow's catch and becomes
   * VARIANT 3: an `ERR_` row that means "we never got an answer".
   *
   * Three things break together when that happens, and none of them errors:
   *   · `api_status` becomes `'failed'`, so payment GATE B refuses to run
   *   · `match_account:false` stops meaning anything — the vendor's own check
   *     becomes mandatory because its "no" is indistinguishable from an outage
   *   · `flex_duplicate`, bound on every hook here, can never be selected
   * And the `ERR_`/`FAIL_` prefixes — an operator's ONLY way to tell an outage
   * from a rejection — start lying.
   *
   * ⇒ THE CONTRACT:
   *   · return a `SlipVerifyResponse` to say "this was an answer" — the flow then
   *     continues down the SUCCESS path exactly as if `send` had resolved, and
   *     the value still goes through `normaliseResponse`, so a fold and a
   *     translation compose instead of each needing to know about the other
   *   · return `null` to say "this was a failure" — the ORIGINAL rejection is
   *     re-thrown untouched, so the flow's catch reads the same `error.response`
   *     and `error.message` it reads today. Behaviour is byte-identical
   *   · **MUST BE TOTAL AND MUST NOT THROW.** It runs while a customer is waiting;
   *     a throw here would replace the vendor's real error with this function's,
   *     which is the one thing the whole seam exists to prevent
   *   · **PURE.** No I/O, no retry, no logging. Settling belongs in `send`
   *     ([DECISION-20260903-NOASYNCSTATE] above)
   *
   * ⚠️ REQUIRED, NOT OPTIONAL, AND THAT IS DELIBERATE. Optional would let the
   * next provider's author never meet the question, and forgetting it is silent:
   * the fold simply does not happen and slips start landing on the `ERR_` branch
   * with the money leg refusing. Required forces one line and one sentence — "my
   * vendor does / does not do this" — written next to that vendor's other facts.
   * Swiftcheck's answer is `null` on everything, stated in its own file rather than
   * assumed from an absent member.
   *
   * ⚠️ THE ERROR TABLE THAT DECIDES THIS IS PER PROVIDER, inside the provider's
   * own file. Vendors do not share a numbering space: Swiftcheck answers STRINGS,
   * SlipGuard answers NUMBERS, and two vendors can both define `1010` meaning
   * different things. A central table would have to be re-keyed per vendor and
   * could not tell those two apart. ตารางโค้ดเป็นของ provider แต่ละตัว
   *
   * 📄 REF: `docs/slip-spec.md` §6.3 (the SlipGuard evidence) and §10 (the gap this
   * closes). The wiring helper is `providers/send-with-recovery.ts`.
   */
  recoverFromError(err: unknown): SlipVerifyResponse | null;
}

/* ==== ✅ [DECISION-20260903-NOASYNCSTATE] "not yet" is NOT modelled ==========
 *
 * Owner call, 03/09: **not built, because not every vendor has it.**
 *
 * WHAT WAS FOUND. Surveying five real vendors turned up one that can answer
 * before it knows: HaveSlip takes `mode: "sync" | "async"` and returns a
 * `status` (`"completed"`, …). This flow has no representation for an
 * unfinished verification — it writes the slip row and answers a card on the
 * assumption the reply is final.
 *
 * WHY NOT BUILDING IT IS THE RIGHT ANSWER RATHER THAN THE LAZY ONE. A pending
 * state is not a field; it is a fourth row variant, a card nobody has written, a
 * lock that must be held without blocking the customer, and something that has
 * to be resumed later. None of it can be designed against a vendor we have not
 * chosen — Swiftcheck, SlipGuard, Slip2Go and QuickSlip all answer synchronously, so
 * every branch of it would be unreachable and untestable the day it was written.
 * That is the same reason the CATCH path is deliberately unbuilt above.
 *
 * ⇒ 🔴 THE PIPE IS LEFT OPEN, AND IT IS A CONTRACT TERM RATHER THAN A FIELD.
 * **A PROVIDER MUST RETURN A SETTLED RESULT.** If its vendor can answer "not
 * yet", settling is that provider's job — it polls, or it asks for sync mode, or
 * it waits — and only then returns. The flow is never handed a pending reply.
 *
 * Everything that needs is ALREADY HERE, which is why nothing was added:
 *   · `send` is `async`, so a provider may take as long as settling requires
 *   · `timeoutMs` is per provider (`SlipVerifyRequest`), so the budget for
 *     settling is the vendor's own number, not a shared one
 *   · `normaliseResponse` runs after settling, so what reaches the row and the
 *     card is a finished answer in the shared shape
 *
 * ⚠️ DELIBERATELY NOT ADDED: a `settled` / `status` field on
 * `SlipVerifyResponse`. Nothing would read it — the flow has no pending branch —
 * and a declared field nobody reads is the same debt as a declared env var
 * nobody reads (`[FIX-20260829-STRIKEENVDEAD]`, which had to be fixed in
 * production). The obligation is stated here instead, where the implementer of
 * the next provider reads it.
 *
 * ⚠️ AND THE LIMIT OF THE PIPE, so it is not oversold: settling inside `send`
 * spends real time on a live conversation. A vendor that routinely takes minutes
 * cannot be absorbed this way, and choosing one is the point at which the
 * pending state has to be designed for real — with that vendor's semantics in
 * hand, which is exactly what is missing today.
 *
 * เผื่อท่อไว้แล้ว: provider ต้องคืนคำตอบที่นิ่งแล้วเสมอ · เจ้าไหน async ก็ไปรอ/poll ในไฟล์ตัวเอง
 * ไม่ต้องเพิ่ม field ที่ไม่มีใครอ่าน — `send` เป็น async และ `timeoutMs` เป็นของรายเจ้าอยู่แล้ว
 *
 * 📄 REF: `docs/slip-spec.md` §12.3.
 */
