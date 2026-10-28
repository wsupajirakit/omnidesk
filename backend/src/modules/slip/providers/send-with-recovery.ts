/**
 * ==== [FEAT-20260903-CATCHSEAM] send, and let the provider read its own error ==
 *
 * WHAT: the one place a rejection from `send` is offered back to the provider
 * that made the call, so a vendor which reports a business verdict as an HTTP
 * error can say "that was an answer" before the flow treats it as an outage.
 *
 * WHY IT IS A SEPARATE FILE AND A SEPARATE FUNCTION. Standing rule, owner 03/09:
 * new work on this path gets its own function in its own file — nothing new is
 * inlined into the flow. It also makes the behaviour testable without a Nest
 * container, a hook, a database or a slip image: it takes a provider and a
 * request and nothing else. ของใหม่บนเส้นนี้ = แยกฟังก์ชัน แยกไฟล์เสมอ
 *
 * 🔴 THE PROPERTY THAT MATTERS MOST — `throw err`, NOT `throw new Error(...)`,
 * and not a wrapped one. `verifySlip`'s catch reads `error.response` and
 * `error.message` off whatever axios raised and turns them into
 * `slipVerifyResult`, `slipCondition` and the `ERR_` row's `raw_response`.
 * Re-throwing anything else — even something friendlier — silently rewrites the
 * failure row on the money path. The original rejection must travel untouched,
 * which is the same rule `send` itself follows by not catching at all.
 *
 * ⇒ FOR A PROVIDER THAT RECOVERS NOTHING (Swiftcheck: `recoverFromError` returns
 * `null` for everything) THIS IS A NO-OP. The rejection goes out of here exactly
 * as it came in, so today's behaviour does not move by a byte — which is what
 * `slip-flow-parity.spec.ts` and the two baselines pin.
 *
 * ⚠️ THE RECOVERED VALUE IS NOT NORMALISED HERE. The caller still passes it
 * through `normaliseResponse`, so a vendor's fold and its envelope translation
 * compose without either having to know about the other. Doing it here would run
 * the normaliser twice on the success path or not at all on this one.
 *
 * ⚠️ NOT A RETRY, AND MUST NEVER BECOME ONE. This runs with a customer waiting
 * and after a request that may already have been charged for. A second attempt
 * belongs behind an explicit decision with its own budget, not inside a helper
 * whose name says "send".
 *
 * revert: delete this file and restore the call site to
 * `await slipProvider.send(verifyRequest)`.
 */
import type {
  SlipProvider,
  SlipVerifyRequest,
  SlipVerifyResponse,
} from './slip-provider.port';

/**
 * @returns the provider's reply — either the one it resolved with, or the one it
 * recognised inside its own rejection.
 * @throws the ORIGINAL rejection, unchanged, when the provider does not claim it.
 */
export async function sendWithRecovery(
  provider: SlipProvider,
  request: SlipVerifyRequest,
): Promise<SlipVerifyResponse> {
  try {
    return await provider.send(request);
  } catch (err) {
    /* The provider is asked exactly once, and it is asked about the rejection it
       produced — nobody else can know whether a 400 from that host means "wrong
       receiver" or "your key is bad". */
    const recovered = provider.recoverFromError(err);
    if (recovered) return recovered;
    /* Not recognised ⇒ a real failure. Re-throw the same object: see the header
       on why a wrapper here would rewrite the money path's failure row. */
    throw err;
  }
}
