/**
 * [PROG-20260905-ASSISTTURN] The part of an assist hand-off that is the TURN, not the site.
 *
 * WHY IT EXISTS — measured, not felt. The spine calls `runAssistGuarded` from three places:
 * the unlinked-slip refusal, the image-answer path, and the AI reply path. Each built its
 * own ~24-field literal, and **nineteen of those fields carried byte-identical expressions
 * at all three sites**. That is not similarity, it is one fact written down three times:
 * who the customer is, which hook and vendor answered, what the operator's Telegram
 * settings are, what the profile lookup found. Only three to five fields per site say
 * anything about the site itself.
 *
 * The cost of three copies is not the lines. It is that a new field has to be added in
 * three places and nobody finds out when it is added in two — which is exactly how a
 * hand-off ends up carrying the vendor on one path and not another.
 *
 * ⚠️⚠️ THE SPINE MUST BUILD THIS WITH AN ARROW, NEVER A VALUE, AND THAT IS BEHAVIOUR.
 * Nine of these nineteen come from `let`s the turn REASSIGNS as it runs —
 * `customerName` is written at four sites, `bangkokTime` at three, `contractCode` and
 * `customerTel` at two, and `mediaUrl`, `userProfile`, `existingUser`, `logContext` and
 * `autoUnassistTriggeredMinutes` each at one. The three call sites sit far apart in the
 * method. Building this object once, early, would freeze whatever those held at the time
 * and hand a later site a stale customer name, an empty clock or a null media url — with
 * every test still green, because the shape would be right and only the values wrong.
 * An arrow re-reads them at the moment of the call, which is what the three literals did.
 * ต้องเป็น arrow · ค่าพวกนี้เปลี่ยนระหว่างรอบ
 *
 * This is the same rule the out-of-hours handler follows for `resolveStatusOffReply`: what
 * looks like a value is a decision about WHEN it is read.
 *
 * ⚠️ It is a SUBSET type on purpose, not the whole argument. `skipAI`, `chatMsgId`,
 * `rawAnswer`, `userText` and the site flags (`forcedTicketCategory`, `isPaymentFlex`,
 * `slipError`, `telegramNotiType`, `incomingMsgType`) genuinely differ per call and belong
 * at the call site, where a reader can see which one applies. Pulling them in here would
 * make the shared object lie about being shared.
 *
 * revert: delete this file, inline the nineteen fields back into each of the three call
 *         sites. Nothing else changes — the merged object is what it always was.
 */

/** The nineteen fields every `runAssistGuarded` call in the spine passes identically. */
export interface AssistTurnArgs {
  /** `?? ''` at every site: the room filter then matches nothing, which is legacy's outcome. */
  userId: string;
  eventTimestamp?: number;
  aiNeedDetailLimit: number | string | null;
  /** [P2-20260813] per-hook vendor + model, so a summary uses the vendor the OA answers with. */
  aiVendor?: string | null;
  aiModel?: string | null;
  /**
   * [FEAT-20260909-DSREASONING] The MAIN lane's reasoning choice, carried from
   * the credentials bundle the reply path already built. The summary shares the
   * bot's setting by the owner's rule, so nothing is resolved a second time.
   * Optional and null for every OA that has not set it.
   */
  aiReasoning?: {
    type: 'enabled' | 'disabled';
    effort?: 'low' | 'high' | 'max';
  } | null;
  autoUnassistMinutes: number | null;
  /**
   * ⚠️ REQUIRED KEY, VALUE MAY BE `undefined` — the two are different guarantees and this
   * is where that distinction earns its keep. Both come off the decrypted credentials by
   * destructuring, so `undefined` is a real value a hook without Telegram produces, and
   * the consumer declares them optional. Writing `string | null` here (the first attempt)
   * was rejected by tsc against the live call site. Writing `telegramKey?:` instead would
   * have compiled — and allowed a future edit to drop the field entirely, which is the
   * omission this interface exists to refuse.
   */
  telegramKey: string | null | undefined;
  telegramChatId: string | null | undefined;
  customerName: string;
  customerTel: string;
  contractCode: string;
  bangkokTime: string;
  /** [P2] the hook's own key; the vendor rule decides the fallback. */
  geminiApiKey?: string;
  alias?: string;
  eventId?: string;
  logContext: Record<string, unknown>;
  mediaUrl: string | null;
  lineDisplayName: string;
  userMongoId?: unknown;
}
