/**
 * [FEAT-20260908-CHATTRANS] one audit row per human-pressed translation.
 * ===========================================================================
 * Owner: *"ถ้า ticket / chat สั่งแปล > เก็บ audit log ด้วยว่า admin คนไหนกดแปล แปลเป็นภาษาอะไร
 * (แต่ตัว ai translate เองจะไม่บังคับ… เผื่อฟังก์ชั่นอื่นเรียกแปล)"*
 *
 * 🔴 THE CALLER WRITES IT, AND `ai-translate` MUST NEVER KNOW ABOUT AUDIT.
 * The module has no actor in its contract and imports `@/modules/audit`
 * nowhere, because a future non-interactive caller has to be able to translate
 * with no actor at all. Recording "who pressed it" is a property of the BUTTON,
 * not of the capability. Same split, same reason, as
 * `member-abandon-audit.helper.ts` — which is also where the "declare only the
 * slice you need" shape below comes from (`:38-40`).
 *
 * ## Which fields, and why they are not guessed
 *
 * `hook_audit_logs` declares `ref_id` as a bare ObjectId with NO `ref`, so it
 * can address any collection, and `parent` is what says which one. Read off 820
 * live rows the convention is `parent` = the subject noun, `action` = the verb
 * (`hook/update` ×406, `flex_message/create` ×37) — hence `chat_message` +
 * `translate`, and `ref_id` = the message id.
 *
 * `changed_fields` is deliberately NOT sent. `ACTIONS_REQUIRING_CHANGES`
 * (`audit-log.service.ts:34-38`) holds `update`, `toggle_status` and
 * `toggle_fast_mode` only, so `translate` does not need one — and a translation
 * has no before/after to record: nothing was changed, something was added.
 *
 * ## ⚠️ FIRE-AND-FORGET, AND THE TRAP THAT COMES WITH IT
 *
 * By the time this runs the translation is already stored and already on its way
 * back to the admin. Failing the request now would tell them the translation did
 * not happen when it did. So the write is not awaited by the route — and that is
 * exactly how a silent gap appears: `audit-log.service.ts` REFUSES a bad payload
 * by throwing, the throw lands in a `.catch()`, and the row vanishes with
 * nothing reported. Live proof from the last time: zero `parent:'line_user'`
 * rows between the abandon shield shipping on 21/08 and the bug being found on
 * 27/08.
 *
 * 🔴 ⇒ THE SPEC MUST ASSERT THE ROW LANDS, never that the call was made. That
 * is why this function returns a promise that NEVER REJECTS instead of `void`:
 * the route ignores it (`void auditMessageTranslate(...)`), and a test can await
 * it and then look for the row. A `void` return would make the landing
 * unobservable and the guard would be exactly as blind as the code it guards.
 *
 * `actor.user_id` is MANDATORY (`audit-log.service.ts:166-168` throws without
 * one), so a request with no authenticated user is reported and skipped rather
 * than sent to be refused.
 *
 * revert: delete this file and its one call in `chat-translate.service.ts`.
 */

/** Just the piece of the audit service this needs — never the whole class. */
export interface TranslateAuditWriter {
  createAuditLog(payload: Record<string, unknown>): Promise<unknown>;
}

export interface TranslateAuditInput {
  /** `chat_messages._id` — what was translated. */
  messageId: string;
  /** The OA whose key was spent. */
  hookId: string | null;
  /** Language of the stored result. */
  to: string;
  /** Source language, when the caller stated one. `null` is the normal case. */
  from: string | null;
  /** Which vendor answered — `null`/unknown reads as gemini everywhere else. */
  vendor: string | null;
  actor?: {
    userId?: string;
    username?: string;
    displayName?: string;
  };
}

/**
 * Records one press. Never rejects.
 *
 * @param warn where a failure is reported; the caller owns the logger.
 * @returns a promise that settles when the write has been attempted, so a spec
 *   can assert the ROW LANDED. The route does not await it — see the header.
 */
export function auditMessageTranslate(
  input: TranslateAuditInput,
  deps: { audit: TranslateAuditWriter; warn: (msg: string) => void },
): Promise<void> {
  const userId = input?.actor?.userId;
  if (!userId) {
    /* `createAuditLog` throws without an actor. The route is behind
       `@RequirePermissions`, so this cannot happen through HTTP; if it ever
       does, losing the row is better than losing the response. */
    deps.warn('[CHATTRANS] audit skipped — no actor on the request');
    return Promise.resolve();
  }

  return deps.audit
    .createAuditLog({
      ref_id: input.messageId,
      parent: 'chat_message',
      action: 'translate',
      /* The OA that paid for it. Absent on a row whose hook cannot be
         resolved — `createAuditLog` normalises only when it is present. */
      ...(input.hookId ? { hook_id: input.hookId } : {}),
      actor: {
        user_id: String(userId),
        username: input.actor?.username,
        display_name: input.actor?.displayName,
      },
      /* Human-readable provenance. It lives HERE and not on the message row
         because the chat page never reads it, and 91% of the richer stored
         shape was metadata nothing renders — shipped on every page load. */
      note: `${input.from ?? 'auto'} → ${input.to} · ${input.vendor || 'gemini'}`,
    })
    .then(() => undefined)
    .catch((err: Error) =>
      deps.warn(`[CHATTRANS] audit failed: ${err.message}`),
    );
}

/**
 * [FIX-20260909-AUDITPREVIEW] The COMPOSER's translate, which recorded nothing.
 *
 * Owner, 09/09, looking at the audit screen: *"ทำไมหน้า audit log ยังไม่ขึ้นว่าใคร
 * กดแปล แปล action ไหน input chat / bubble chat"*. Two different faults answered
 * that question, and this is the second.
 *
 * The read side always wrote a row (and every one was refused by an enum until
 * today). The composer side never called an audit at all — a press there spends
 * exactly the same money as a press on a bubble, and left no trace of who did it.
 *
 * 🔴 THE TWO ARE TOLD APART BY `parent`, not by a flag inside a note. A bubble
 *    translate is about a MESSAGE that exists (`chat_message` + its id); a
 *    composer translate is about a ROOM and a draft that may never be sent
 *    (`chat_room` + the room id). Anyone filtering the audit screen by subject
 *    gets the split for free, and no reader has to parse prose to find it.
 *
 * ⚠️ Same fire-and-forget contract as its sibling: an audit failure must never
 *    cost the admin their preview. The route ignores the promise; this catches.
 */
export function auditPreviewTranslate(
  input: {
    roomId: string;
    hookId?: string | null;
    to: string;
    from?: string | null;
    vendor?: string | null;
    actor?: { userId?: string; username?: string; displayName?: string };
  },
  deps: { audit: TranslateAuditWriter; warn: (msg: string) => void },
): Promise<void> {
  const userId = input?.actor?.userId;
  if (!userId) {
    deps.warn('[CHATTRANS] preview audit skipped — no actor on the request');
    return Promise.resolve();
  }

  return deps.audit
    .createAuditLog({
      ref_id: input.roomId,
      parent: 'chat_room',
      action: 'translate',
      ...(input.hookId ? { hook_id: input.hookId } : {}),
      actor: {
        user_id: String(userId),
        username: input.actor?.username,
        display_name: input.actor?.displayName,
      },
      /* "composer" names the surface in the one place a human reads. The
         machine-readable split is `parent` above. */
      note: `composer · ${input.from ?? 'auto'} → ${input.to} · ${input.vendor || 'gemini'}`,
    })
    .then(() => undefined)
    .catch((err: Error) =>
      deps.warn(`[CHATTRANS] preview audit failed: ${err.message}`),
    );
}
