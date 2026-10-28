/**
 * ==== [FEAT-20260809-REQUIREPROFILE] "no account ⇒ do not verify the slip" ====
 *
 * WHAT: decides whether an inbound slip should be REFUSED before the Swiftcheck
 * verification runs, because the sender has no account with this OA.
 *
 * WHY IT EXISTS: a customer who has never linked an account can still transfer
 * money and send a slip. Today that spends a billed Swiftcheck verification, writes
 * a SlipVerification row, and only fails later at the topup leg — after which an
 * operator has to clean up. Refusing at the door costs nothing and gives the
 * customer an answer they can act on ("link your account, then resend").
 * ลูกค้ายังไม่มีบัญชี = ไม่ต้องเสียค่าเช็คสลิป บอกให้ไปผูกบัญชีก่อน.
 *
 * WHY A SEPARATE FLAG (`slip_require_profile`), not tied to the payment feature:
 * an OA may want this rule with no topup/walletpay configured at all. It is a
 * slip-checking policy, so it is gated by its own switch beside `slip_check`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ THE ONE THING THAT MUST NOT BE GOT WRONG — FAIL OPEN
 * ═══════════════════════════════════════════════════════════════════════════
 * "no profile DATA" is NOT "no ACCOUNT". A profile lookup returns nothing for
 * many reasons that have nothing to do with the customer:
 *   · the upstream is down / timed out
 *   · the circuit breaker is open
 *   · 401/403 — the tool's token is wrong
 *   · the tool has no endpoint flagged `is_profile` (a config mistake)
 *   · the OA has not configured a profile source at all
 *
 * If any of those were treated as "not a customer", then during a five-minute
 * upstream outage EVERY customer — including long-standing ones — would be told
 * they have no account, and NOT ONE slip would be verified. That is a far worse
 * failure than the wasted call this gate exists to avoid.
 *
 * ⇒ This function returns `true` (block) ONLY on an explicit, positive
 * "this customer does not exist" answer. Everything else returns `false`
 * (proceed exactly as before). When in doubt, verify the slip.
 * ไม่ชัด = ปล่อยผ่าน ทำเหมือนเดิม.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * HOW TO CHANGE LATER:
 *   · another upstream signals "not found" differently → add it to
 *     `isExplicitNotFound` below, and ONLY if it is unambiguous.
 *   · the customer-facing text → `slip_require_profile_text` on the hook.
 *   · to disable everywhere → the flag defaults to false; no code change.
 * revert: delete this file + its call site in webhook.service.
 */

/** The profile block the webhook already extracted, shape-agnostic. */
export interface ProfileProbe {
  /** The `is_profile` endpoint's response block, or null when absent. */
  profileBlock?: Record<string, unknown> | null;
  /** True when the circuit breaker short-circuited the call. */
  circuitOpen?: boolean;
}

/**
 * Is this an explicit "the customer does not exist" answer?
 *
 * STRICT ON PURPOSE. Only an HTTP 404 carried on the profile block counts —
 * that is the one status whose meaning is unambiguous ("the thing you asked for
 * is not here"). 500s, timeouts, 401/403 and empty bodies all mean "we do not
 * know", so they are NOT accepted here.
 *
 * ⚠️ Do NOT widen this to "any failure" or "empty data". That is precisely the
 * outage-amplifying mistake described in the file header.
 */
function isExplicitNotFound(block: Record<string, unknown>): boolean {
  const status = block['status'];
  // `status` may arrive as a number or a numeric string depending on the
  // upstream adapter; both are accepted, nothing else is.
  return status === 404 || status === '404';
}

/**
 * @returns `true` when the slip must NOT be verified — the customer provably has
 *   no account. `false` in every other case, including every failure, so the
 *   flow continues exactly as it does today.
 */
export function shouldBlockUnlinkedSlip(
  hook: Record<string, unknown> | null | undefined,
  probe: ProfileProbe,
): boolean {
  // 1. OFF BY DEFAULT. `=== true` (never a truthy test) so the string 'false',
  //    0 or any junk value cannot silently switch a customer-facing rule on.
  if (!hook || hook['slip_require_profile'] !== true) return false;

  // 2. The circuit breaker fired ⇒ we learned NOTHING about this customer.
  //    Explicitly first, because a short-circuited call can still leave a block
  //    behind and must never be read as an answer.
  if (probe.circuitOpen === true) return false;

  // 3. No block at all ⇒ misconfiguration or a dead upstream, NOT a verdict.
  const block = probe.profileBlock;
  if (!block || typeof block !== 'object') return false;

  // 4. A successful lookup means the customer EXISTS — nothing to block.
  if (block['success'] === true) return false;

  // 5. Block ONLY on an explicit "not found".
  return isExplicitNotFound(block);
}

/**
 * ==== [FEAT-20260907-UNKNOWNPROFILEREVIEW] the third answer stops being silent ====
 *
 * The profile lookup has THREE outcomes, and until now only two were acted on:
 * the customer exists (verify), or the upstream says they provably do not
 * (refuse). The third — "the call ran and failed" — fell through to verification
 * with nothing said, so a slip was auto-checked against a customer nobody could
 * identify, and the answer looked exactly like a normal one.
 *
 * This decides that third case. The turn should stop and hand the slip to a
 * human instead: the reply is the card the dashboard binds to the payment state
 * `review` and labels *"auto check ไม่ได้ ต้องให้ admin ดู"*.
 * ตรวจอัตโนมัติไม่ได้ = ต้องบอก ไม่ใช่เดินต่อเงียบ ๆ
 *
 * 🔴 IT DOES NOT TOUCH THE 404 PATH. An explicit not-found is a VERDICT and
 *    belongs to `shouldBlockUnlinkedSlip` above — same refusal, same card, same
 *    wording as before this existed. Both functions are asked, and at most one
 *    can say yes, because step 3 here hands 404 back to its sibling.
 *
 * 🔴 "RAN AND FAILED" IS NOT "NEVER RAN", and the difference is the whole safety
 *    of this function. `build-turn-context.ts:64-68` states the contract the
 *    gates already rely on: `profileBlock === undefined` means the fetch never
 *    happened, `null` means it happened and produced no block. Only a real
 *    answer object counts here. Two cases that would otherwise send EVERY slip
 *    to a human are therefore excluded by construction:
 *      · the turn never reached the fetch                      (`undefined`)
 *      · no endpoint carries the `is_profile` flag — a configuration mistake, the one
 *        `combined-profile.ts:207-210` reports in those words (`null`)
 *
 * ⚠️ AN OPEN CIRCUIT COUNTS. The breaker opens BECAUSE the upstream has been
 *    failing, so it is the strongest evidence of "we cannot check right now"
 *    available — even though its sibling reads it as a reason to fail open.
 *    The two readings are deliberate and opposite: for REFUSING a customer,
 *    an open circuit proves nothing about them; for AUTO-CHECKING their money,
 *    it proves we should not.
 *
 * ⚠️ IT IS GATED BY `slip_require_profile`, the same switch as its sibling. An
 *    OA that does not require an account has not asked the system to care who
 *    the sender is, and forcing their slips into review would be a policy they
 *    never chose.
 *
 * ⚠️ SAYING YES HERE IS NOT THE SAME AS SENDING A CARD. The step that acts on
 *    this resolves `payment_flex_ids.review` through the existing
 *    `resolveStateFlex`, which returns null for an unbound or deleted card — and
 *    null means "do exactly what you did before". So an OA that has not bound
 *    that card sees no change at all, with no extra setting to discover.
 *
 * @returns `true` when the slip must NOT be auto-checked because the identity of
 *   the sender could not be established. `false` whenever the answer was
 *   conclusive either way, and whenever no attempt was made.
 */
export function shouldReviewUnknownProfile(
  hook: Record<string, unknown> | null | undefined,
  probe: ProfileProbe,
): boolean {
  // 1. Same switch, same strictness as `shouldBlockUnlinkedSlip`.
  if (!hook || hook['slip_require_profile'] !== true) return false;

  // 2. The breaker fired — the call did not get an answer, and the reason is a
  //    failing upstream. Checked before the block because a short-circuited call
  //    can leave a stale block behind that would read as an answer.
  if (probe.circuitOpen === true) return true;

  const block = probe.profileBlock;

  // 3. No answer object at all ⇒ never ran, or nothing configured to run. NOT a
  //    failure of the upstream, and NOT this function's business.
  if (!block || typeof block !== 'object') return false;

  // 4. It answered, and the customer exists. Nothing unknown.
  if (block['success'] === true) return false;

  // 5. It answered "no such customer" — that is the refusal path, untouched.
  if (isExplicitNotFound(block)) return false;

  // 6. It answered, and the answer was a failure: 500, a timeout body, 401/403,
  //    anything else. This is the case.
  return true;
}
