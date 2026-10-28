/*
 * ==== [FIX-20260812-HELPERMARKERLEAK] hook-field replies must resolve markers ====
 *
 * THE BUG
 *   `missing_api_data_text` and `image_answer_text` are routinely set to the marker
 *   `[[[customer-helper]]]` — the tag that is meant to become a register button. The
 *   three sites that send those fields never called `resolveReplyTags`, which runs
 *   only on the AI path (`webhook.service.ts:2911`), so the customer received the
 *   literal brackets. The repo forbids that outright:
 *   "The owner's rule is absolute: a reply sent to a customer must never contain
 *   `[[[...]]]` or `[[...]]`" (`reply-tags.util.ts:224-226`).
 *
 * ⚠️ WHY A NAIVE "JUST STRIP IT" FIX IS WRONG
 *   A marker-only field strips down to an EMPTY string. Sending empty text makes LINE
 *   answer 400 and the customer gets silence — worse than brackets. That exact bug
 *   already happened (`[FIX-20260801-HELPEREMPTY]`, `webhook.service.ts:3055-3060`).
 *   The AI path solves it by substituting `resolveCustomerHelperText(hook)` whenever
 *   the tag is present (`:3068-3072`). This helper copies that proven shape rather
 *   than inventing a second one.
 *
 * WHAT IT DOES
 *   Takes the raw hook-field text and returns what should actually be sent:
 *   the resolved text plus whether the register quick reply belongs with it.
 *   It performs no I/O — no mint, no DB, no LINE call — so it cannot slow down or
 *   break the path it sits on. The caller stays in charge of sending.
 *
 * ── MODES (owner asked for "ถอดได้ หยุดได้ สลับได้") ───────────────────────
 *   'off'   → [FIX-20260901-OFFMENUTAG] REDEFINED on 01/09, and now the only mode
 *             in use. It resolves the three families that must never reach a
 *             customer raw — `[[link]]`, `[[[customer-helper]]]`, and the menu
 *             marker (whose card it reports) — and leaves EVERYTHING else
 *             byte-identical, including `[[odk_s_*]]` and `[[[assist]]]`.
 *             ⚠️ It deliberately does NOT run `resolveReplyTags`: that function's
 *             catch-all deletes every `[[…]]`, which is what removed a deposit
 *             amount from a customer's message on 01/09.
 *             Until 01/09 this branch returned the raw text untouched, brackets
 *             and all — which is how the markers reached production.
 *   'strip' → markers are removed; when a marker was the whole field the customer
 *             gets `customer_helper_text` instead of an empty message. No buttons.
 *   'button'→ same text as 'strip', and the caller is told to attach the register
 *             quick reply (`wantsHelperQuickReply`).
 *   'flex'  → [FEAT-20260812-HOOKHELPERFLEX] the CARD replaces the text entirely.
 *             This file still only resolves TEXT for that mode (same result as
 *             'strip'), because the text is what the caller falls back to when the
 *             card cannot be built. The card itself is built by `hook-helper-flex.ts`,
 *             which owns the mint and the DB read — see the note below on why they do
 *             not live here.
 *
 *   The modes are ordered by how much the customer's experience changes, so a
 *   rollout can stop at any step. Switching is a config change, never a deploy.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO — STILL TRUE AFTER 'flex' WAS ADDED
 *   It never builds the flex card, not even in 'flex' mode. Building one needs a minted
 *   link token and a read from the flex collection; doing that here would put I/O and a
 *   second failure surface on paths whose whole job is to answer quickly when something
 *   has already gone wrong. `hook-helper-flex.ts` carries that risk instead, and it
 *   answers `null` on any failure so the caller sends the text this file returned.
 *   ⇒ this function stays synchronous and cannot fail.
 *
 * revert: delete this file and the `[FIX-20260812-HELPERMARKERLEAK]` blocks in
 *         `webhook.service.ts` (grep the tag) — the fields then send raw again.
 */
import {
  findMenuCardTagRef,
  hasCustomerHelperTag,
  resolveCustomerHelperText,
  resolveReplyTags,
  stripCustomerHelperTag,
  stripMenuCardTagRefs,
  stripUnknownMarkers,
  substituteAnswerLink,
} from './reply-tags.util';

/**
 * How far marker resolution is allowed to go. Kept as a string union rather than a
 * boolean so a third behaviour never has to become a second flag.
 */
export type HookTextReplyMode = 'off' | 'strip' | 'button' | 'flex';

/** The default. `off` means "behave exactly as before this fix shipped". */
export const HOOK_TEXT_REPLY_DEFAULT_MODE: HookTextReplyMode = 'off';

export interface HookTextReplyInput {
  /** The raw hook field, e.g. `hook.missing_api_data_text`. */
  rawText: string | null | undefined;
  /** The hook document — read for `customer_helper_text` and `answer_link`. */
  hook: Record<string, unknown> | null | undefined;
  mode: HookTextReplyMode;
}

export interface HookTextReplyResult {
  /** What to send. Never empty unless the caller passed nothing to begin with. */
  text: string;
  /** Attach the register quick reply? Only ever true in `'button'` mode. */
  wantsHelperQuickReply: boolean;
  /**
   * [FEAT-20260831-MENUMAINTAG] The stored MENU card this field named, or null.
   *
   * An operator may write `[[[menu_main_00010]]]` into a hook field. The strip
   * above then correctly leaves nothing — a marker must never reach a customer —
   * and a caller that sent only `text` would send an EMPTY message, which LINE
   * refuses with 400. That is exactly what happened to `image_answer_text` on
   * 31/08. Reporting the tag lets the caller send the CARD instead.
   *
   * ⚠️ Reported, never sent: this function is pure and total, and the caller owns
   * delivery. `'off'` mode reports null like it reports everything else — that
   * path is byte-for-byte untouched by design.
   */
  wantedMenuCardTag: string | null;
}

/**
 * Read the mode off a hook, tolerating anything an operator may have stored.
 *
 * ⚠️ Unknown values fall back to `'off'` on purpose: a typo in the field must not
 *    silently enable a customer-visible change.
 */
export function resolveHookTextReplyMode(
  hook: Record<string, unknown> | null | undefined,
): HookTextReplyMode {
  const raw = hook?.['hook_text_reply_mode'];
  /* [FEAT-20260812-HOOKHELPERFLEX] 'flex' joins the list. Anything unrecognised is
     still read as 'off', so a typo can never switch a customer-visible change on. */
  return raw === 'strip' || raw === 'button' || raw === 'flex'
    ? raw
    : HOOK_TEXT_REPLY_DEFAULT_MODE;
}

/**
 * Turn a raw hook field into the text that may be sent to a customer.
 *
 * @returns the text to send and whether the register buttons belong with it.
 *
 * ⚠️ Pure and total — no throw, no await. It sits on paths where the customer is
 *    already waiting for an answer after something failed upstream.
 */
export function resolveHookTextReply(
  input: HookTextReplyInput,
): HookTextReplyResult {
  const raw = String(input.rawText ?? '');

  /* `off` is the untouched path: same string in, same string out.
   *
   * [FIX-20260901-OFFMENUTAG] …with ONE exception, and only one: a menu marker.
   *
   * WHY. Measured on the live OA on 01/09, both directions:
   *
   *   mode    menu marker in this field        `[[odk_s_*]]` in the reply
   *   ----    -------------------------------  --------------------------
   *   off     🔴 sent RAW — admin AND customer  ✅ resolves correctly
   *   flex    ✅ the card is sent               🔴 deleted, the amount vanishes
   *
   * Neither value is correct and they fail in opposite directions, so no setting
   * fixed it. The owner's decision: `off` is the only mode from now on, and it
   * has to be right on its own. ใช้ off อย่างเดียว ต้องทำงานครบ.
   *
   * WHY THIS IS NOT A BREACH OF THE `off` CONTRACT. That contract protects an
   * operator's own words. A marker is not their words — it is an instruction to
   * this system that only this system can carry out, and sending it verbatim is
   * not "untouched", it is a failure to act on it. The repo already accepted this
   * argument on 19/08 in `refusal-reply-mode.ts`, whose header records the
   * deciding fact, re-verified 01/09: **the dashboard has no control for this
   * column at all** — four i18n labels, zero rendered inputs. So `off` can only
   * ever mean "never configured", never "deliberately chosen".
   *
   * WHAT IS DELIBERATELY *NOT* DONE HERE. This does not fall through to the
   * stripping path below. That path runs `resolveReplyTags`, whose catch-all also
   * deletes every `[[…]]`, which is exactly what breaks the dynamic family under
   * `flex`. Routing `off` through it would trade one production bug for the
   * other — the loop this change exists to end. Only the menu marker is removed;
   * `[[link]]`, `[[odk_s_*]]`, `[[[assist]]]`, `[[[customer-helper]]]`, plain
   * text and every other shape come out byte-identical to before.
   *
   * A field that was ONLY a marker now yields `''`. That is correct and expected:
   * the caller sends the CARD instead, and an empty string is what tells it the
   * card is the whole reply. `webhook.service.ts` handles that case explicitly.
   *
   * revert: return `{ text: raw, …, wantedMenuCardTag: null }` as before. The two
   * lines below and `stripMenuCardTagRefs` are the entire change. */
  if (input.mode === 'off') {
    const menuTag = findMenuCardTagRef(raw);

    /* Three targeted passes, never the whole pipeline. Each touches ONE family.

       1. `[[link]]` → the OA's `answer_link`. Measured 01/09: ZERO hooks hold one,
          so this changes nothing today; it exists so a NEW hook created after the
          schema default flips still gets it.
       2. `[[[customer-helper]]]` → removed. Measured 01/09: 13 of 28 hooks hold
          one, every occurrence in `missing_api_data_text`, and under `off` they
          were sending the raw brackets to customers. `[FIX-20260812-HELPERMARKERLEAK]`
          was written in 08/2026 to stop exactly that, but it was gated on a mode
          whose default is `off` — so on most hooks that fix never ran at all. Same
          shape as the dead menu rung: the code existed and nothing reached it.
       3. the menu marker → removed, and the card reported.

       ⚠️ NOT stripped here, deliberately: `[[[assist]]]`. Every customer-facing
          site already removes it — `reply-tags.util.ts:276` on the AI path,
          `webhook.service.ts:4794` on the image path — and the ticket decision
          reads the RAW field independently (`:3039`, whose comment states "the
          marker is matched on the RAW field"). A fourth stripper here would be a
          second owner for one job, and the admin row is REQUIRED to keep it
          (owner, 12/08).

       ⚠️ NOT stripped either: `[[odk_s_*]]` and every other `[[…]]`. That is the
          whole point — the stripping path below deletes them, and that is what
          took the deposit amount out of a customer's message on 01/09. */
    let text = substituteAnswerLink(raw, input.hook?.['answer_link']);
    if (hasCustomerHelperTag(text)) {
      const stripped = stripCustomerHelperTag(text);
      /* A field that was ONLY the marker strips to nothing, and LINE refuses an
         empty message — the customer then gets silence, which is worse than
         brackets (`[FIX-20260801-HELPEREMPTY]`). The stripping path answers this
         with `customer_helper_text`; `off` gives the same answer rather than
         inventing a second one. When the operator wrote real copy around the
         marker, their words are kept and nothing is substituted. */
      text = stripped || resolveCustomerHelperText(input.hook ?? {});
    }
    if (menuTag) text = stripMenuCardTagRefs(text);

    /* ==== [FIX-20260901-OFFRAWGUARD] nothing raw may leave, except assist ====
     *
     * The three passes above handle the families that HAVE an answer here. This
     * closes the rest, and it exists because the previous version of this branch
     * was measured leaking:
     *
     *   field content                     customer received (before this line)
     *   `see promo [[[flex_m00019]]]`     `see promo [[[flex_m00019]]]`
     *   `hello [[[totally_made_up]]]`     `hello [[[totally_made_up]]]`
     *   `hello [[whatever]] there`        `hello [[whatever]] there`
     *   `a [START_OF_BASIC_INFO] b`       `a [START_OF_BASIC_INFO] b`
     *
     * The rule is absolute and covers BOTH sides: nothing raw to the customer and
     * nothing raw on the admin row. `[[[assist]]]` is the one exception — the
     * admin row is required to carry it (owner, 12/08) and the ticket decision
     * reads it off the raw field — which is why `keepAssist` exists rather than a
     * plain call. ห้ามดิบทั้งฝั่งลูกค้าและแอดมิน ยกเว้น assist อย่างเดียว
     *
     * ⚠️ REUSES `resolveReplyTags`' own catch-all rather than repeating it. The
     *    marker set is open — the model can invent one and a prompt edit can add
     *    one — so two sweeps would drift apart the day a shape is added.
     *
     * ⚠️ MEASURED POPULATION, 01/09: across 28 hooks × 7 reply-text fields, every
     *    marker present is `assist` (24), `customer-helper` (14) or a menu tag (1)
     *    — all three already handled above, and **0** of anything else. So this
     *    line changes nothing about today's data; it stops an operator from
     *    creating the leak by typing one tomorrow.
     *
     * ⚠️ A DYNAMIC TAG HERE IS STRIPPED, NOT SUBSTITUTED — the one honest
     *    compromise, and it is safe only because of a RULE, not because of luck:
     *    a dynamic tag lives in the Training Document and nowhere else (owner,
     *    01/09). Admins do not type one into `default_answer_text` or its
     *    siblings — measured the same day, 0 occurrences across 28 hooks × 7
     *    reply-text fields. This path runs when something upstream already failed
     *    and it holds no tag values, so the only choice is raw or gone, and raw is
     *    forbidden on both sides. The ESCAPE case that actually cost a customer —
     *    a tag in the MODEL'S ANSWER — is substituted, not stripped, one layer up.
     *
     * ┌─ IF THAT RULE IS EVER RELAXED ────────────────────────────────────────┐
     * │ Should a dynamic tag one day be allowed in `default_answer_text` and   │
     * │ friends, THIS LINE BECOMES WRONG — it would silently delete an amount  │
     * │ an operator meant to show, which is the exact 01/09 defect wearing a   │
     * │ different hat. Do not "fix" it by removing the sweep; that only trades │
     * │ the deletion back for a raw leak. What is actually required:           │
     * │                                                                        │
     * │  1. give this function the tag values. It is pure and synchronous by   │
     * │     design, so the CALLER must resolve them — `webhook.service.ts` has │
     * │     the deps at all five call sites (`:2974`, `:4685`, `:4780`,        │
     * │     `:4829`, `:5354`). Pass in a `substituteEscapedTags`-shaped        │
     * │     function, the same one `substituteDynamicTags` already returns.    │
     * │  2. apply it BEFORE this sweep, exactly as the AI path does — the      │
     * │     order is the contract: substitute, then sweep whatever is left.    │
     * │  3. decide what an UNRESOLVABLE tag becomes here. `N/A` is already     │
     * │     taken and the Training Document forbids the model answering `N/A`, │
     * │     so reusing it would make two different failures indistinguishable. │
     * │  4. re-run `z-test/manual/prove-tag-escape-truth.ts` — its matrix is   │
     * │     what proves the two tag families still resolve independently.      │
     * │                                                                        │
     * │ ⚠️ Note the cost that made it not worth doing today: resolving tags    │
     * │    here means a database read on a path whose whole job is to answer   │
     * │    quickly when something has ALREADY gone wrong.                      │
     * │ ⇒ ถ้าวันหน้าจะให้ใส่ dyntag ใน default ได้ ต้องส่งค่ามาให้ก่อนแล้วค่อยกวาด │
     * └────────────────────────────────────────────────────────────────────────┘
     *
     * revert: delete this line. The four shapes above reach customers again. */
    text = stripUnknownMarkers(text, { keepAssist: true });

    return {
      text,
      /* Still false. The quick reply belongs to `button` mode; removing a marker
         does not imply the customer asked for buttons. */
      wantsHelperQuickReply: false,
      wantedMenuCardTag: menuTag,
    };
  }

  /* `answer_link` substitutes `[[link]]`. Only a string is meaningful — anything
     else would stringify to '[object Object]' and be sent to a customer as a URL. */
  const rawLink = input.hook?.['answer_link'];
  const answerLink = typeof rawLink === 'string' ? rawLink : '';
  const tags = resolveReplyTags(raw, answerLink);

  /* The substitution that prevents silence — but ONLY when stripping left nothing.
     A field like "ยังไม่พบข้อมูล [[[customer-helper]]]" still has real copy the OA
     wrote, and replacing it would throw away their words. The AI path can substitute
     unconditionally (`webhook.service.ts:3070-3072`) because there the text comes from
     the model, not from an operator; here it is the operator's own message. */
  const text =
    tags.finalReplyForLine ||
    (tags.wantsHelperQuickReply
      ? resolveCustomerHelperText(input.hook ?? {})
      : tags.finalReplyForLine);

  /* [FEAT-20260812-HOOKHELPERFLEX] 'flex' falls through to here on purpose and comes
     out identical to 'strip': stripped text, no quick reply. That text is the FALLBACK
     the caller sends when `buildHookHelperFlex` answers null (mint down, card missing,
     wrong group). The quick reply stays off for 'flex' because the card carries its own
     buttons — attaching both would show the customer the same action twice. */
  return {
    text,
    wantsHelperQuickReply:
      input.mode === 'button' && tags.wantsHelperQuickReply,
    /* [FEAT-20260831-MENUMAINTAG] carried straight through from the one resolver
       that reads it. Nothing is decided here — the caller sends the card or does
       not, and this function stays pure. */
    wantedMenuCardTag: tags.wantedMenuCardTag,
  };
}
