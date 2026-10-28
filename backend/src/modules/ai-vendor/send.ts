/**
 * [FEAT-20260908-AIVENDORSEND] The one line that actually reaches a vendor.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 10
 * ===========================================================================
 * By this point the door already owned the URL, the body, the reader, the
 * timeout, and both result envelopes — but `axios.post` still appeared in six
 * transport files. So "one place talks to a vendor" was true of everything
 * EXCEPT the talking.
 *
 * This is the last line for the six lane transports: reply, assist-summary and
 * ticket translate, each in both vendors. Every request those lanes make leaves
 * through here.
 *
 * ⚠️ [FIX-20260908-OVERCLAIM] THIS USED TO SAY "every AI request in the system
 *    now leaves through here", AND THAT WAS NOT TRUE. Two files reach a vendor
 *    without passing through this function:
 *      · `slip/qr-vision.service.ts` — borrows only `geminiUrl` and posts its own
 *        socket, with its own 15s budget. It is also not called by anything
 *        reachable (see the note at the top of that file).
 *      · `ai/rag-engine.service.ts` — four `axios.post` sites, all inside methods
 *        with no production caller (`askGemini`, `analyzeConversationForAdmin`,
 *        `analyzeCategoryFromRoom`) except `findRelevantText`, whose DI token is
 *        never bound (see `doc-retrieval/doc-retrieval.provider.ts`).
 *    Plus the two `/models` LISTING callers, which are a different endpoint and
 *    were never in scope.
 *
 *    So the honest claim is the one written above: every request from the six
 *    lanes. `ai-vendor-single-door.spec.ts` enforces exactly that and no more —
 *    it checks the transports, which is why the overclaim survived unchallenged.
 *
 * 🔴 IT IS A PASS-THROUGH, ON PURPOSE. No retry, no backoff, no logging, no
 *    error translation. Each of those is a real improvement and each changes
 *    behaviour, so none of them rides in on a move. What this buys is not
 *    cleverness — it is that the set of places a request can leave from is now
 *    ENUMERABLE, and `ai-vendor-single-door.spec.ts` enforces it: a transport
 *    that imports axios directly turns the census red.
 *
 * ⚠️ THE REPLY LANE'S RETRY LADDER DID NOT MOVE, and this file is what lets it
 *    stay put safely. `gemini-reply.transport.ts` calls this three times — the
 *    first attempt, the 400-on-"think" re-fire after deleting a key from the
 *    body, and the timeout retry on a SHORTER options object — with its own
 *    decisions between them. Those decisions are that lane's contract, evidenced
 *    over 24h of production rows, and they are not a "policy" this file gets to
 *    generalise on the strength of one example. A retry abstraction with exactly
 *    one real implementation is speculative generality, and on the customer
 *    money path the cost of getting it wrong is a reply that never arrives.
 *
 * ⚠️ CONFIG IS PASSED THROUGH UNTOUCHED, including the SAME OBJECT identity.
 *    `GEMINI_HTTP_OPTS` is shared by nine call sites and a spec asserts the first
 *    attempt receives that exact object (`toBe`, not `toEqual`). Cloning or
 *    merging it here — even into an identical shape — fails that pin and would
 *    quietly break the "never mutated, never re-keyed" guarantee it documents.
 *
 * ── [PLAN-20260908-RETRYGAP] KNOWN GAP, DECISION PENDING — not an oversight ──
 * Measured 08/09/2026: retry exists in exactly ONE reachable lane, the reply
 * ladder described above. **Summary, translate and qr-vision are single-shot.**
 * One 429 or one 503 from the vendor and the feature produces nothing, with no
 * user-visible error — the summary is simply absent from the ticket, the
 * translation simply does not appear, the slip simply is not pre-scanned.
 *
 * ⚠️ An earlier note counted `askGemini`'s ladder as a second implementation.
 *    That method has no production caller (see `gemini-reply.provider.ts:14`), so
 *    its retry never runs. The count behind "we already have two examples" is
 *    one, not two — which strengthens rather than weakens the argument against
 *    generalising a policy from it today.
 *
 * The open question is not "should this file gain retry" but "should those three
 * lanes get any retry at all, and if so whose shape". It is on the owner's
 * decision list; nothing here changes until it is answered. Written down so the
 * silence is a recorded choice rather than something a future reader discovers
 * from a customer complaint.
 *
 * revert: delete this file and restore `axios.post(...)` at each call site. The
 * arguments are unchanged, so the restore is mechanical.
 */
import axios from 'axios';

/** What a vendor answered. Deliberately narrow — callers read `status`/`data`. */
export interface VendorResponse {
  status?: unknown;
  data?: unknown;
}

/**
 * POST to a vendor.
 *
 * @param url    built by `geminiUrl` or the DeepSeek constant — never by a caller
 * @param body   built by `buildGeminiBody` / `buildDeepSeekBody`
 * @param config the axios options object, passed by identity (see the header)
 *
 * Rejections propagate unchanged so the caller can inspect the error — the reply
 * lane branches on `response.status === 400` and on a timeout, and swallowing or
 * re-wrapping the error here would take that away.
 */
export async function postToVendor(
  url: string,
  body: unknown,
  config: unknown,
): Promise<VendorResponse> {
  return await axios.post(url, body, config as never);
}
