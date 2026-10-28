import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';

/**
 * The LINE Messaging API calls the webhook flow makes.
 *
 * PORTED — line for line, including the parts that look wrong.
 * Source: legacy-api/src/controllers/core-bot/webhookController.js
 *   · sendLineReplyMessage      (958)  → POST /v2/bot/message/reply
 *   · sendLineFlexReply         (129)  → POST /v2/bot/message/reply
 *   · sendLinePushMessage       (1985) → POST /v2/bot/message/push
 *   · sendLineLoadingIndicator  (2007) → POST /v2/bot/chat/loading/start
 *   · getLineProfile            (2028) → GET  /v2/bot/profile/{userId}
 *
 * WHY AXIOS AND NOT `fetch`
 * Not a preference — a contract. Three of these five hand their *whole* axios
 * response back to the caller, which reads `.status` and `.data` off it
 * (legacy:3777, 3820, 3891, 1968). Two of them let the axios rejection escape,
 * and the callers read `.message` off it (legacy:3851) or `.response.data`
 * (the flex logger below). `fetch` resolves on a 4xx and carries neither shape,
 * so porting to it would mean rebuilding throw-on-non-2xx and an axios-shaped
 * error by hand — a second HTTP style AND a reimplementation of the thing the
 * callers branch on. This repo already sends LINE traffic through axios with a
 * module-scope timeout constant (external/hook-outbound.service.ts:457); this
 * file matches that.
 *
 * ⚠️ NO RETRIES ANYWHERE. Legacy has none — no axios-retry, no interceptor, no
 * loop. A 500 from LINE is one attempt and one failure. Do not "improve" this;
 * a reply token is single-use and burns on the first accepted attempt.
 *
 * ⚠️ NO TOKEN VALIDATION ANYWHERE. Legacy interpolates the token straight into
 * the header, so an absent one sends the literal string `Bearer undefined` and
 * LINE answers 401. That 401 is then handled *differently by each function*
 * (throw / throw / throw / swallow / null), and callers depend on that
 * difference. `checkHeaderToken` exists in this repo, and deliberately is not
 * called here: adding it would turn a 401 into a local throw and change which
 * branch the webhook takes. See the per-method notes.
 *
 * ⚠️ Legacy pins `axios.defaults.httpAgent/httpsAgent` to keep-alive agents at
 * process start (legacy-api/src/index.js:22). That is a socket-pooling
 * decision, not a behavioural one — same requests, same responses — so it is
 * left to this repo's own bootstrap rather than reproduced here.
 */

/** legacy:config.js:17 — `config.channels.line.apiEndpoint`, a hardcoded URL. */
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
/** legacy:45 — `LINE_PUSH_URL`. */
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
/** legacy:2010 — inlined at the call, not a constant. */
const LINE_LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';
/** legacy:2031 — the user id is appended raw, unencoded. */
const LINE_PROFILE_URL_PREFIX = 'https://api.line.me/v2/bot/profile/';

/**
 * legacy:2168 — one budget for every LINE call, reply and push alike.
 *
 * The legacy comment records the measurement it came from: observed max in
 * `webhook_logs` was 241 ms for a reply and 1223 ms for a push, so 15 s is
 * roughly 12x headroom. It exists because a hung socket on the *customer reply*
 * path is the worst failure this flow has.
 */
const LINE_HTTP_TIMEOUT_MS = 15_000;

/**
 * A LINE quick-reply block, passed through untouched.
 *
 * Legacy builds these as plain objects and never inspects them again, so the
 * only property that matters is that the value reaches the wire unchanged.
 */
export type LineQuickReply = Record<string, unknown>;

/** A flex message `contents` bubble/carousel, passed through untouched. */
export type LineFlexContents = Record<string, unknown>;

/**
 * The body of `GET /v2/bot/profile/{userId}`.
 *
 * The index signature is load-bearing: legacy returns `response.data` verbatim,
 * so any field LINE adds survives into the caller. Declaring only the four
 * fields the webhook reads would be a lie about what the value contains.
 */
export interface LineProfile {
  userId?: string;
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
  [key: string]: unknown;
}

@Injectable()
export class LineApiService {
  private readonly logger = new Logger(LineApiService.name);

  /**
   * legacy:958 — plain text reply.
   *
   * NO try/catch. The axios rejection propagates raw and the caller owns it:
   * at legacy:3808-3852 a failure here is caught, logged by `.message`, and
   * answered `res.status(500).send("Reply failed")`. Anything that swallows or
   * re-wraps the error breaks that branch, so the thrown value must stay an
   * axios error.
   *
   * Returns the whole axios response, not the body — callers read `.status`
   * into `http_status` and `.data` into `response_summary` (legacy:3779-3787).
   */
  async sendLineReplyMessage(
    accessToken: string,
    replyToken: string,
    text: string,
    quickReply: LineQuickReply | null = null,
  ): Promise<AxiosResponse<unknown>> {
    const message: Record<string, unknown> = {
      type: 'text',
      text,
    };
    if (quickReply) {
      message['quickReply'] = quickReply;
    }

    return axios.post(
      LINE_REPLY_URL,
      {
        replyToken,
        messages: [message],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: LINE_HTTP_TIMEOUT_MS,
      },
    );
  }

  /**
   * legacy:129 — flex reply.
   *
   * Same endpoint and same return shape as `sendLineReplyMessage`, but it logs
   * on both paths and then rethrows, so a failure is logged twice: once here,
   * once by whichever caller catches it.
   *
   * ⚠️ The success-path log dumps the ENTIRE flex payload on every single send
   * (legacy:139). It is unconditional — no debug flag. Kept because it is the
   * only trace of what was actually rendered, and dropping it would remove a
   * signal operators are currently reading.
   *
   * [PERF-20260824-FLEXLOGCOMPACT] What changed on 2026-08-24 is the FORM, not
   * the content: the payload is no longer pretty-printed. `JSON.stringify(x,
   * null, 2)` ran synchronously on the reply path before every send, and on a
   * carousel (up to 10 bubbles) the indentation roughly tripled the bytes and
   * turned one entry into hundreds of lines. Compact output serialises the same
   * object, character for character in terms of DATA — every key and value the
   * operator was reading is still there, on one line. Owner decision: keep the
   * signal, drop the padding.
   *
   * revert: restore `, null, 2` as the 2nd/3rd args of the JSON.stringify below,
   *         and flip `line-api.spec.ts` back to asserting the indented form.
   *
   * ⚠️ `altText` defaults to the English "Bank Transfer Details" even though
   * every call site passes a Thai string (legacy:3217, 3581, 3654, 1952). The
   * default is therefore unreachable in practice; it is preserved rather than
   * corrected because "unreachable today" is not "unreachable".
   */
  async sendLineFlexReply(
    accessToken: string,
    replyToken: string,
    flexContents: LineFlexContents,
    altText = 'Bank Transfer Details',
    quickReply: LineQuickReply | null = null,
  ): Promise<AxiosResponse<unknown>> {
    try {
      const message: Record<string, unknown> = {
        type: 'flex',
        altText: altText,
        contents: flexContents,
      };
      if (quickReply) {
        message['quickReply'] = quickReply;
      }

      this.logger.log(
        `[FLEX-DEBUG] Sending Flex Message. Payload Contents: ${JSON.stringify(flexContents)}`,
      );

      return await axios.post(
        LINE_REPLY_URL,
        {
          replyToken,
          messages: [message],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: LINE_HTTP_TIMEOUT_MS,
        },
      );
    } catch (err) {
      // `err.response?.data || err.message` — on an HTTP failure this is LINE's
      // JSON body; on a timeout or DNS failure there is no response, so it
      // falls back to the message string, which `JSON.stringify` then wraps in
      // quotes. Both forms are reproduced exactly.
      const errorData = LineApiService.axiosErrorData(err);
      this.logger.error(
        `Failed to send LINE Flex reply: ${JSON.stringify(errorData, null, 2)}`,
      );
      throw err;
    }
  }

  /**
   * legacy:1985 — push (used when the reply token is spent or absent).
   *
   * Like `sendLineReplyMessage`: no try/catch, rejection propagates, the whole
   * response comes back (legacy:3951 reads `.status`/`.data` off it).
   *
   * ⚠️ Unlike the two reply helpers, this one takes NO `quickReply` — legacy
   * hardcodes a single text message and there is no parameter for one. A push
   * therefore silently drops any quick reply the flow computed. Reproduced as
   * found.
   */
  async sendLinePushMessage(
    accessToken: string,
    userId: string,
    text: string,
  ): Promise<AxiosResponse<unknown>> {
    return axios.post(
      LINE_PUSH_URL,
      {
        to: userId,
        messages: [
          {
            type: 'text',
            text,
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: LINE_HTTP_TIMEOUT_MS,
      },
    );
  }

  /**
   * ==== [FEAT-20260808-PAYTOOL-P3] flex over push — NOT a legacy port ====
   *
   * WHAT: same flex bubble as `sendLineFlexReply`, delivered through the PUSH
   * endpoint instead of the reply endpoint.
   *
   * WHY IT EXISTS: the payment runner classifies some outcomes as `review`, and
   * that reply is a flex card whose whole point is its buttons (retry /
   * contact-admin). A reply token is single-use and short-lived, so when it is
   * already spent the flow must fall back to push — and `sendLinePushMessage`
   * above is text-only (legacy hardcodes one text message; see its ⚠️). Falling
   * back through it would silently DROP the buttons on the one reply that needs
   * them, on the money path.
   *
   * WHY THIS SHAPE (and why not a mode flag): reply and push differ only in the
   * endpoint and the recipient key (`replyToken` vs `to`) — the `messages[]`
   * payload is identical, so LINE accepts a flex push natively. Giving push the
   * same flex capability the reply path already has keeps ONE delivery rule
   * ("send the same kind, just change the pipe") instead of a
   * text-or-flex-on-fallback switch, which would mean two code paths where only
   * one is ever exercised in production — the unused one rots. No degrade, no
   * flag, no dead branch. เลือกทางนี้เพราะ no tech debt: ปุ่มไม่หาย และไม่มี
   * สาขาโค้ดที่ไม่ได้ใช้ให้ต้องดูแล.
   *
   * WHY IT DOES NOT TOUCH `sendLinePushMessage`: that one is a byte-faithful
   * legacy port with existing callers on the text path. This is an ADDITIVE
   * sibling, so nothing already verified changes behaviour.
   *
   * HOW TO CHANGE IT LATER:
   *   · different alt text            → pass `altText` at the call site.
   *   · quick replies on a push       → add a `quickReply` param exactly as
   *     `sendLineFlexReply` does (LINE supports it here too); deliberately
   *     omitted now because no payment state produces one.
   *   · stop pushing flex entirely    → change the fallback in
   *     `payment-reply/` delivery, NOT this method; it is a plain capability.
   *
   * Returns the whole axios response and lets rejections propagate, matching the
   * two reply helpers so callers can read `.status`/`.data` into webhook_logs.
   * revert: delete this method (no legacy code path depends on it).
   */
  async sendLinePushFlexMessage(
    accessToken: string,
    userId: string,
    flexContents: LineFlexContents,
    altText = 'Bank Transfer Details',
  ): Promise<AxiosResponse<unknown>> {
    return axios.post(
      LINE_PUSH_URL,
      {
        to: userId,
        messages: [
          {
            type: 'flex',
            altText,
            contents: flexContents,
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: LINE_HTTP_TIMEOUT_MS,
      },
    );
  }

  /**
   * legacy:2007 — the "typing…" animation.
   *
   * SWALLOWS EVERYTHING. On any failure it logs `err.message` and returns
   * `undefined`; it never rejects. That is deliberate in legacy — a cosmetic
   * indicator must not be able to abort a customer reply — and the one call
   * site is fire-and-forget with its own `.catch(() => {})` on top
   * (legacy:2583), so the promise is never inspected either way.
   *
   * ⚠️ Consequence worth stating: an expired or wrong channel token produces a
   * 401 here that is invisible to the flow. This function cannot be used as a
   * token health check.
   */
  async sendLineLoadingIndicator(
    accessToken: string,
    userId: string,
    loadingSeconds = 20,
  ): Promise<AxiosResponse<unknown> | undefined> {
    try {
      return await axios.post(
        LINE_LOADING_URL,
        {
          chatId: userId,
          loadingSeconds,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: LINE_HTTP_TIMEOUT_MS,
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to send LINE loading indicator: ${LineApiService.errorMessage(err)}`,
      );
      return undefined;
    }
  }

  /**
   * legacy:2028 — profile lookup.
   *
   * Returns `response.data` on success and `null` on ANY failure.
   *
   * ⚠️ `null` is the answer for a 404 (user has not added the OA / blocked it),
   * a 401 (dead token), a 500 and a socket timeout alike — the four are
   * indistinguishable to the caller. legacy:4374-4383 then logs
   * `status: profileResponseData ? "success" : "error"` and
   * `http_status: profileResponseData ? 200 : 0`, so every one of those
   * failures is recorded as `http_status: 0` and a genuine 200 is recorded as
   * 200 whether or not that is what LINE actually returned. Collapsing the
   * distinction is the ported behaviour; the caller that wants to tell them
   * apart cannot, and that is a real limitation, not an oversight here.
   *
   * ⚠️ `userId` is interpolated into the path with no encoding and no
   * emptiness check. legacy:4373 passes `event.source?.userId`, which is
   * `undefined` for a source type that carries none — the request then goes to
   * `.../profile/undefined`, LINE 400s, and this returns `null`. Preserved: a
   * guard here would skip the outbound call, and the webhook_log row legacy
   * writes for that attempt would disappear.
   *
   * NOTE the log level: `console.warn` in legacy, not `console.error` — a
   * missing profile is expected traffic, not an incident.
   */
  async getLineProfile(
    accessToken: string,
    userId: string,
  ): Promise<LineProfile | null> {
    try {
      const response = await axios.get<LineProfile>(
        `${LINE_PROFILE_URL_PREFIX}${userId}`,
        {
          // No Content-Type — legacy sends only Authorization on this GET.
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: LINE_HTTP_TIMEOUT_MS,
        },
      );
      return response.data;
    } catch (err) {
      this.logger.warn(
        `LINE profile fetch failed for user: ${userId} ${LineApiService.errorMessage(err)}`,
      );
      return null;
    }
  }

  // ── error shape helpers ────────────────────────────────────────────────
  // JS reads `.message` and `.response?.data` off a caught value without
  // checking what it is. TypeScript types a catch binding as `unknown`, so the
  // same two reads are spelled out here rather than behind an `any`.

  /** `err.message` as JS would read it, including on a non-Error throw. */
  private static errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    const message = (err as { message?: unknown } | null)?.message;
    return typeof message === 'string' ? message : String(message);
  }

  /** `err.response?.data || err.message`. */
  private static axiosErrorData(err: unknown): unknown {
    const data = (err as { response?: { data?: unknown } } | null)?.response
      ?.data;
    return data || LineApiService.errorMessage(err);
  }
}
