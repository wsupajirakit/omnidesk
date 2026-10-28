import { translateNow } from '../../i18n';
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

/**
 * [FEAT-20260908-AITRANSLATE] the two translate calls, and nothing else.
 * ===========================================================================
 * Written to the contract PINNED in
 * `omnidesk-api/todo/task/08092026/WORK-SPLIT_chattrans.md` §8, not invented here:
 *
 *   POST /api/chat/messages/:id/translate   body { to }
 *     → { success: true, data: { lang, text, from, to, cached } }
 *     → 429 { success: false, error: "<human-readable>" }   rate limited
 *     → 502                                                 the OA has no usable key
 *
 *   POST /api/chat/:id/translate-preview    body { text, to }
 *     → { success: true, data: { text } }        🔴 STORES NOTHING
 *
 * 🔴 THE TWO ARE NOT INTERCHANGEABLE, and the difference is the whole design:
 * the first is about a message that EXISTS and it WRITES (the translation is
 * appended to `chat_messages.translations`, which is why a second press on the
 * same language comes back `cached: true` with no vendor call). The second is
 * about text that does not exist yet and it writes NOTHING — the admin has not
 * pressed send, so there is no message to attach anything to. Routing the
 * composer through the first would create a stored translation of a message
 * nobody sent. อันแรกเขียน อันหลังไม่เขียนอะไรเลย.
 *
 * ── WHY THIS FILE HAS NO ERROR HANDLING OF ITS OWN ──────────────────────────
 * `handleApiResponse` (services/apiClient.ts) already throws an `ApiError` whose
 * `.message` is the server's own `error` string (its `candidate` chain reads
 * `parsed?.error` explicitly) and whose `.status` is the HTTP code. So a 429
 * arrives at the caller as an Error already carrying the readable sentence the
 * BE wrote — which is precisely what §4C demands be shown "as-is", and what a
 * `catch` here that re-worded it would destroy. Every other call in
 * `chatService.ts` leans on the same pipe; this is not a new style.
 * 🔴 NO RETRY LIVES HERE EITHER. A 429 means "you already spent your six"; an
 * automatic second attempt spends a seventh and is refused too. See `isRateLimited`.
 *
 * ── WHY IT IS A SEPARATE FILE FROM `chatService.ts` ─────────────────────────
 * That file is 603 lines and is imported by four pages; this feature ships on
 * ONE. A separate module means the whole feature reverts by deleting one file
 * and its call sites, and it keeps the AI-billing surface visible in the import
 * graph rather than buried among thirty room/message helpers.
 *
 * revert: delete this file, `services/chat/index.ts`'s line for it, and its two
 *   callers (`pages/chat/TicketChat.tsx`, `components/chat/chat-input/`).
 */

/**
 * What `POST /api/chat/messages/:id/translate` answers with.
 *
 * ⚠️ `lang`/`from`/`to` are the SAME strings that land in
 * `chat_messages.translations[]` — a display choice and a storage choice at
 * once (the cross-repo contract C established). Do not reshape them on arrival:
 * the bubble reads `from`/`to` verbatim and `ChatMessage.translations` is
 * declared to exactly this shape.
 */
export interface TranslateResult {
  /** language of `text` — equal to `to` for a message translated after the fact */
  lang: string;
  /** the translation itself */
  text: string;
  /** ┐ where the text came FROM. [FEAT-20260910-DETECTSOURCE] it is populated
   *  again: the admin still never states one, but the model reports it in the
   *  same reply and the BE stores whichever is known — stated first, detected
   *  second, `null` when neither. `TranslatedBubble` prints the target alone
   *  when this is null, which is every row written before today. */
  from: string | null;
  /** ┘ the target the admin picked */
  to: string;
  /**
   * true = the BE already had this exact translation stored and returned it
   * without calling a vendor. **Not an error and not a warning** — it is the
   * cheap path working. The UI has no reason to render it differently; it is
   * declared because the contract carries it and swallowing a documented field
   * makes the next reader think the BE stopped sending it.
   */
  cached: boolean;
}

/**
 * What `POST /api/chat/:id/translate-preview` answers with — the text, alone.
 *
 * 🔴 `from` IS DECLARED BUT IS NOT PART OF THE PINNED CONTRACT, and that is
 * deliberate. The contract says the preview returns `{ text }`, so this side
 * must work when `from` never arrives — hence optional, and hence every reader
 * of it below is guarded.
 *
 * WHY IT IS HERE AT ALL: on send, the composer owes the BE `original_lang` (the
 * language of the Thai the admin typed) — and **the FE has no honest way to
 * know it.** The admin never states a source language, there is no detector in
 * the browser, and the UI locale is the admin's *panel* language, not the
 * language of the sentence they just typed (an English-UI operator typing Thai
 * would be labelled `en`). Guessing would write a wrong `from` into the
 * database, which is worse than writing none: a wrong label is indistinguishable
 * from a right one afterwards. เดาผิด แย่กว่าไม่รู้.
 *
 * ⇒ Until the BE echoes the source it detected, the composer sends
 * `original_text` alone and `original_lang` is simply absent — the stored entry
 * gets `from: null`, exactly like every read-side translation, and
 * `TranslatedBubble` already renders the target alone in that case. The moment
 * Agent D adds `from` to this response (purely additive), the composer starts
 * sending a REAL detected language with no further edit on this side.
 */
export interface TranslatePreviewResult {
  text: string;
  /** the source the MODEL detected, if the BE chooses to echo it. Never a guess. */
  from?: string | null;
}

/**
 * 🔴 THE SOURCE LANGUAGE IS NEVER CHOSEN BY A HUMAN. Owner, 09/09:
 * *"เราไม่จำเป็นต้องเลือก src lang เพราะว่าเรารู้อยู่แล้ว และ ai ก็คิดได้อยู่แล้ว"*
 *
 * The wire keeps `from` optional — the core module accepts it deliberately, so
 * a future non-UI caller can pass one — but **no control in this app produces
 * it and no function in this file populates it.** The body carries `to`, and
 * on the preview call `text`, and that is the entire body.
 *
 * `test/chatTranslateRequest.value.test.ts` asserts the absence of the KEY, not
 * merely that it is undefined, so a source selector cannot reappear by accident.
 * ไม่มีปุ่มเลือกภาษาต้นทาง ที่ไหนทั้งนั้น.
 */
/**
 * [FIX-20260909-TRANSLATETIMEOUT] 20 seconds, and only for translate.
 *
 * Owner, 09/09: *"แปลแล้วค้างไม่มี timeout อะไรเลยหรอ … ควรมีนะ 20 วิ แล้วบอก modal
 * จริงแล้วให้กดลองใหม่ (เฉพาะแปลภาษา timeout 20)"*.
 *
 * 🔴 A HUNG TRANSLATE HAS NO FLOOR WITHOUT THIS. The vendor call is made
 *    server-side and DeepSeek with thinking enabled can take many seconds; if
 *    it never answers, `fetch` waits as long as the browser lets it and the
 *    admin sits on a spinner with no way back. An abort at least turns silence
 *    into a message.
 *
 * ⚠️ SCOPED TO THIS SERVICE ON PURPOSE. `authFetch` is shared by every call in
 *    the dashboard; putting a 20s ceiling there would cap uploads, exports and
 *    every long-running admin action at a number chosen for translation.
 *
 * ⚠️ Aborting does NOT stop the server. A translation already in flight may
 *    still land and still be stored — which is why a retry is cheap on the read
 *    side: the second press usually answers from the cache the first one filled.
 */
export const TRANSLATE_TIMEOUT_MS = 20_000;

/** Marks the error an abort produces, so a caller can say "หมดเวลา" and offer a retry. */
export class TranslateTimeoutError extends Error {
  constructor() {
    super('translate timed out');
    this.name = 'TranslateTimeoutError';
  }
}

export const isTranslateTimeout = (err: unknown): boolean =>
  err instanceof TranslateTimeoutError;

/** `fetch` with a deadline, translating an abort into a named error. */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    return await run(ac.signal);
  } catch (err) {
    if (ac.signal.aborted) throw new TranslateTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const aiTranslateService = {
  /**
   * Translate a message that EXISTS, and store the result on it.
   *
   * `messageId` is OUR `_id` (the same id-space the bubble and the patch use),
   * NOT LINE's `provider_msg_id` — the route is `/api/chat/messages/:id/…`.
   */
  translateMessage: async (
    messageId: string,
    to: string,
    /**
     * [FEAT-20260910-SOURCEPIPE] the source language, WHEN A CALLER KNOWS ONE.
     *
     * 🔴 Nothing on screen sends this today and nothing should: the admin is
     *    never asked, and the model detects it (`translate-envelope.ts` on the
     *    server). The parameter exists because the BE has validated an optional
     *    `from` since the route shipped, and the day a source picker is added it
     *    must be a value travelling, not a route being widened.
     * ⚠️ OMITTED ≠ null-on-the-wire. Absent leaves the key off the body
     *    entirely, so a call without it is byte-identical to yesterday's.
     */
    from?: string | null,
  ): Promise<{ success: boolean; data: TranslateResult }> => {
    const res = await withTimeout((signal) => authFetch(`${API_BASE_URL}/api/chat/messages/${encodeURIComponent(messageId)}/translate`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      /* 🔴 `{ to }`, plus `from` only when a caller stated one. Never `text` —
         the BE reads the message it already holds, so sending the on-screen text
         would let a stale render decide what gets translated and stored. */
      body: JSON.stringify(from ? { to, from } : { to }),
    }));
    return handleApiResponse<{ success: boolean; data: TranslateResult }>(res, 'translate message');
  },

  /**
   * Translate text the admin is still typing. **Stores nothing, sends nothing.**
   *
   * `roomKey` is the room `_id` or `line_user_id` — the same key every other
   * room-scoped call in `chatService.ts` takes. Room-scoped rather than
   * ticket-scoped on purpose: a room always exists where an open ticket may not.
   */
  previewTranslate: async (
    roomKey: string,
    text: string,
    to: string,
    /** [FEAT-20260910-SOURCEPIPE] see `translateMessage` — same rule, same reason. */
    from?: string | null,
  ): Promise<{ success: boolean; data: TranslatePreviewResult }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${encodeURIComponent(roomKey)}/translate-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* 🔴 `{ text, to }`, and `from` only when stated — see the block above. */
      body: JSON.stringify(from ? { text, to, from } : { text, to }),
    });
    return handleApiResponse<{ success: boolean; data: TranslatePreviewResult }>(res, 'preview translation');
  },
};

/**
 * Was this failure the 6-per-minute preview limit?
 *
 * 🔴 IT EXISTS SO THE UI CAN **DISABLE A BUTTON**, NEVER SO IT CAN RETRY.
 * §4C: *"Never auto-retry a 429"* — the whole point of the limit is that the
 * seventh press inside the minute must not happen, and a retry is exactly that
 * press with the human removed. There is no retry helper in this file and there
 * must not be one.
 *
 * ⚠️ It reads `.status`, which `buildApiError` attaches to every error it makes
 * — not the message text. Matching on wording would break the moment the BE
 * rewords its sentence, which §4C requires the FE to display verbatim and
 * therefore to have no opinion about.
 */
export const isRateLimited = (err: unknown): boolean =>
  !!err && typeof err === 'object' && (err as { status?: number }).status === 429;

/**
 * The sentence to show the operator — **the server's own, whenever there is one.**
 *
 * §4C: *"Show that message as-is; do not invent a friendlier one that hides how
 * long to wait."* The BE's 429 envelope says how many are left and when the
 * window turns over; a hardcoded "ลองใหม่ภายหลัง" throws that away and the
 * admin presses again immediately, which is the behaviour the limit exists to
 * stop. The fallback is used ONLY when the error carries no message at all —
 * §0c decision 7 warns that a cap hit currently reaches the browser as a blank
 * `{"error":"internal error"}`, so "no message" is a real case, not a defensive
 * habit. ข้อความจากเซิร์ฟเวอร์เท่านั้น ห้ามแต่งเอง.
 */
export const translateErrorText = (err: unknown, fallback = translateNow('ticketui.panel.translate_failed', 'แปลข้อความไม่สำเร็จ')): string => {
  /* [FIX-20260909-TRANSLATETIMEOUT] The abort's own message is "translate timed
     out" — true, English, and useless to the admin. It is the ONE error this
     helper rewords, because it is the one this codebase raises itself; every
     other message here came from the server and saying it verbatim is the rule
     (a 429 states how long to wait, a 502 states the OA has no key). */
  if (isTranslateTimeout(err)) {
    return translateNow('ticketui.panel.translate_timeout', 'แปลไม่เสร็จภายใน {s} วินาที — กดแปลอีกครั้งได้').replace('{s}', String(TRANSLATE_TIMEOUT_MS / 1000));
  }
  const msg = (err as { message?: unknown } | null)?.message;
  let text = typeof msg === 'string' ? msg.trim() : '';

  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.cloudflare_error || parsed.error_code === 502 || parsed.status === 502) {
        return translateNow('ticketui.panel.translate_502', 'เซิร์ฟเวอร์ขัดข้อง (502 Bad Gateway) — ระบบปลายทางไม่สามารถตอบสนองได้ในขณะนี้ กรุณารอสักครู่แล้วลองใหม่');
      }
      if (parsed.detail || parsed.title || parsed.error || parsed.message) {
        const title = parsed.title ? `[${parsed.title}] ` : '';
        const detail = parsed.detail || parsed.error || parsed.message || '';
        text = `${title}${detail}`.trim();
      }
    } catch {
      // not valid json, keep raw text
    }
  }

  return text || fallback;
};
