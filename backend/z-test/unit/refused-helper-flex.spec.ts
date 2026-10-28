/* [FEAT-20260818-REFUSEDHELPERFLEX] `slip_require_profile_text` sends the CARD
 * ===========================================================================
 * Owner, 18/08: `[[[customer-helper]]]` mints a button in every other operator
 * field but not in "ข้อความตอบคนที่ยังไม่ผูกบัญชี". A review of `main` found the
 * reason and, worse, a comment that already claimed the opposite:
 * `[FIX-20260812-REFUSEDMARKERS]` promised *"with `hook_text_reply_mode: 'flex'`
 * it can send the card … needs no code change"* — but the site resolved the
 * marker to TEXT and then called a TEXT-only sender, and `buildHookHelperFlexFor`
 * was invoked at three other sites and never this one.
 *
 * These specs pin the wiring at the same layer the sibling site is pinned
 * (`customer-helper-flex-history.spec.ts` — source structure, comments stripped),
 * because instantiating this service is not how this file is tested here.
 * The runtime proof is the live flow test; this is the regression fence.
 *
 * THE PROPERTY THAT MATTERS MOST — seamlessness. `buildHookHelperFlexFor`
 * answers null in every mode but 'flex', when the field has no marker, and on
 * any failure. So the specs below check BOTH directions: the card path exists,
 * AND the text path is still the untouched else-branch. ของเดิมต้องไม่ขยับ.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { tsFilesUnder } from '../lib/source-census';
import { spineCodeOnly } from '../lib/spine-sources';

const ROOT = join(__dirname, '..', '..');

/**
 * The spine PLUS its role directories, comments removed so assertions can only match real
 * code.
 *
 * [PROG-20260905-G19] This used to read `webhook.service.ts` alone. The refusal branch has
 * moved to `hook-reply/unlinked-slip-refusal.handler.ts` — the RULES below did not move,
 * so the reader follows the code instead of the file. Not a widening that makes anything
 * easier to pass: every anchor here occurs exactly once across the concatenation, and a
 * rule that holds nowhere still fails. ตามโค้ดไป ไม่ใช่ตามไฟล์
 *
 * ⚠️ THE COLLABORATOR PREFIX WAS NEVER THE RULE. Inside the spine the branch called
 * `this.sendFlexReply(...)`; inside a handler it calls `deps.sendFlexReply(...)`, because a
 * role file takes its collaborators through `deps` and imports no service. The assertions
 * that named `this.` are folded to a single token below so they keep asserting the SHAPE —
 * one ternary, card first, awaited — which is what they were written to protect.
 */
function codeOnly(): string {
  return foldPrefix(spineCodeOnly(ROOT));
}

/**
 * `this.x(` and `deps.x(` both become `«call».x(`.
 *
 * The same normaliser the slip-twin pin uses. A body that moves into a role directory
 * keeps its calls and changes only who it asks, and a pin that fails on that is asserting
 * the file layout, not the behaviour.
 */
function foldPrefix(src: string): string {
  return (
    src
      .replace(/\b(?:this|deps)\./g, '«call».')
      /* And the INPUT prefix is dropped entirely. Inside the spine the branch read
         `msgType`; inside a handler it reads `input.msgType`, because the values arrive in
         one object. WHICH VALUE is stored is the rule these cases protect; WHERE it is read
         from is file layout. Same normalisation the slip-twin pin makes for `meta.`/`args.`. */
      .replace(/\binput\./g, '')
  );
}

/** The refusal branch only — from the field read to its `persistWebhookLog`. */
function refusalBranch(): string {
  const code = codeOnly();
  // `const refusalRaw =` is unique; the field name itself also appears in the
  // img-flow probe payload above, which would slice the wrong region.
  const start = code.indexOf('const refusalRaw =');
  /* End on the failure log that follows the send. The LOG CALL itself is not a
     stable anchor across lanes: the wrap-log work renames `persistWebhookLog`
     to `wlogEmit`, and a spec that pins the branch must not pin the lane. */
  const end = code.indexOf('[REQUIREPROFILE] reply failed', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end + 400);
}

describe('[FEAT-20260818-REFUSEDHELPERFLEX] the refusal copy can send the card', () => {
  it('builds the helper card from the refusal field, through the shared builder', () => {
    // The RAW field is passed, not the stripped text: the builder is what looks
    // for the marker, and stripping removes the very thing it looks for.
    expect(refusalBranch()).toContain('await «call».buildHookHelperFlexFor(');
    expect(refusalBranch()).toMatch(
      /buildHookHelperFlexFor\(refusalRaw, refusalMode\)/,
    );
  });

  it('sends the card through the flex sender when one was built', () => {
    /* [FEAT-20260828-PUSHCORE-A2] the RECEIVER was renamed, the rule was not.
       `this.lineApi.sendLineFlexReply` became `this.sendFlexReply` when the
       fourteen direct reply sites moved onto the push core; the new method
       mirrors the old signature argument for argument, which is why every other
       expectation in this file is untouched. What this still pins is the shape:
       ONE ternary, card first, send awaited. เปลี่ยนชื่อคนรับสาย กฎเดิมทุกข้อ */
    expect(refusalBranch()).toMatch(
      /const res = refusalCard\s*\?\s*await «call»\.sendFlexReply\(/,
    );
  });

  it('keeps the ORIGINAL text send as the else-branch, argument for argument', () => {
    // Seamless: with no card this is the same call the site always made — and
    // the argument list below is unchanged by the A-2 rename, which is the point.
    expect(refusalBranch()).toMatch(
      /:\s*await «call»\.sendTextReply\(replyToken \?\? '', text\)/,
    );
  });

  it('never mints while an admin holds the room', () => {
    // Minting a link token is a real side effect and nothing is sent then
    // ([FIX-20260812-REFUSEDSILENTWHENASSISTED] keeps the bot silent).
    expect(refusalBranch()).toMatch(
      /const refusalCard = skipBotProcessing\s*\?\s*null\s*:/,
    );
  });

  it('mirrors the card into chat history instead of a text bubble', () => {
    expect(refusalBranch()).toContain(
      "messageType: refusalCard ? 'flex' : 'text'",
    );
  });

  it('stores the card with its uri stripped, and the bound doc id', () => {
    // A minted link must never sit in history — the sibling sites strip it too.
    expect(refusalBranch()).toContain(
      'flex_json: «call».stripHelperUri(refusalCard)',
    );
    expect(refusalBranch()).toContain(
      "flex_doc_id: hook?.['flex_customerhelper_id'] ?? null",
    );
  });

  it('keeps the raw operator copy on the admin row (unchanged behaviour)', () => {
    // [FIX-20260812-REFUSEDMARKERS] — the operator must still see their markers.
    expect(refusalBranch()).toContain('content: refusalRaw');
    expect(refusalBranch()).toContain('sent_text: text');
  });

  it('distinguishes the two sends in webhook_logs', () => {
    // Resolved to ONE name above the log object so that object's shape stays
    // byte-identical to before — a multi-line ternary inside it made prettier
    // re-flow lines this change never touched.
    const code = codeOnly();
    expect(code).toContain("? 'slip_refused_no_profile_flex'");
    expect(code).toContain('action_type: refusalAction,');
  });
});

/* [FIX-20260819-REFUSEDIMGHISTORY] the customer's own image is always recorded
 * ===========================================================================
 * Reported from production 19/08 (log …04-44-48, req 3301): customer
 * U4059348d… uploaded two slips, both were refused for having no linked
 * account, and the chat room showed only the bot's replies — the images
 * themselves were nowhere.
 *
 * Cause, read from the branch: the customer's row was written inside
 * `if (refusalWantsAssist)`, so a hook whose refusal copy carries
 * `[[[customer-helper]]]` (or no marker at all) recorded nothing. The branch
 * `return`s at :2312, long before the normal logging site at :2428, so no
 * later code could pick it up either — the original comment's assumption that
 * "the assisted-room path already logs it" does not hold from inside here.
 *
 * These specs pin the separation the fix rests on:
 *   · the message row is written UNCONDITIONALLY — a customer sent something,
 *     so the room must show it, ticket or no ticket;
 *   · the TICKET is still marker-gated — `refusalWantsAssist` keeps deciding
 *     whether assist runs, so no OA starts getting tickets it never asked for.
 * เก็บรูปเสมอ · แต่ ticket ยังผูกกับ marker เหมือนเดิม.
 */
describe('[FIX-20260819-REFUSEDIMGHISTORY] the refused image reaches the room', () => {
  it('writes the customer row outside the assist condition', () => {
    const branch = refusalBranch();
    const logIdx = branch.indexOf("senderType: 'customer'");
    const gateIdx = branch.indexOf('if (refusalWantsAssist)');
    expect(logIdx).toBeGreaterThan(-1);
    // The gate must NOT open before the write — that is exactly the bug.
    expect(gateIdx === -1 || gateIdx > logIdx).toBe(true);
  });

  it('still records what the customer actually sent, not a placeholder', () => {
    const branch = refusalBranch();
    expect(branch).toContain('messageType: msgType');
    expect(branch).toContain('content: msgContent');
    // the stored media id is what lets the admin open the picture
    expect(branch).toContain('internalContentId');
  });

  it('keeps the ticket marker-gated — assist behaviour is unchanged', () => {
    // The gate itself lives in the sliced branch; the assist call that consumes
    // the row id sits further down, past this slice's end anchor, so it is
    // asserted against the whole comment-stripped source.
    expect(refusalBranch()).toContain('const refusalWantsAssist =');
    expect(codeOnly()).toContain("chatMsgId: refusalCustomerMsg?.['_id']");
  });

  it('a failed history write still must not cost the customer their reply', () => {
    expect(refusalBranch()).toContain('customer message log failed');
  });
});

/* [FIX-20260819-DIVIDERHELPERLABEL] the suppressed-check divider reads for a HUMAN
 * ===========================================================================
 * Owner, 19/08, after seeing `🔎 ผลตรวจสลิป: [[[customer-helper]]]` in the admin
 * chat: the divider exists ONLY so an operator can see what the bot would have
 * answered while they hold the room. A marker is not an answer — it is markup,
 * and it tells the operator nothing about why the slip stopped.
 *
 * SCOPE, exactly as instructed — divider text and nothing else:
 *   · ONLY this flow: the unlinked-slip refusal, and only the suppressed arm
 *     (room already assisted). It is the single `logSystemMessage` in the branch.
 *   · ONLY when the operator's copy carries `[[[customer-helper]]]`. Any other
 *     copy keeps showing the resolved reply text verbatim.
 *   · The CUSTOMER path is untouched — same send, same card, same minted button.
 *     These specs assert that too, so a future edit cannot quietly widen this.
 * แตะแค่ข้อความใน divider · ฝั่งลูกค้าและปุ่มห้ามขยับ.
 */
describe('[FIX-20260819-DIVIDERHELPERLABEL] the divider says what an operator needs', () => {
  it('routes the divider text through the tested helper, not an inline rule', () => {
    /* The wording and the marker rule now live in
       `hook-reply/suppressed-check-divider.ts`, pinned by BEHAVIOURAL specs in
       `suppressed-check-divider.spec.ts`. What this file still owns is the
       WIRING: that this divider — and only this one — asks that helper, with
       the RAW field and the resolved text, in that order. */
    expect(codeOnly()).toMatch(
      /* [PROG-20260905-LINT] The trailing comma is optional now. This matched
         `resolveSuppressedCheckText(\n  refusalRaw,\n  text,\n)` including the dangling
         comma prettier adds to a multi-line call — and when the handler was formatted, the
         call fit on one line and the comma went with the line break. The rule is WHICH TWO
         VALUES reach the helper and in what order; whether the call wraps is the
         formatter's business. Third pin this program has had to un-anchor from whitespace. */
      /content: `🔎 ผลตรวจสลิป: \$\{resolveSuppressedCheckText\(\s*refusalRaw,\s*text,?\s*\)\}`/,
    );
  });

  it('keeps the label to ONE home — a copy anywhere else is a second truth', () => {
    /* [PROG-20260905-G19] THIS CASE WAS REWRITTEN BECAUSE WIDENING THE READER BROKE IT,
       and that break was correct. It used to assert the label is ABSENT from
       `webhook.service.ts`. The reader now spans the role directories — which include
       `hook-reply/suppressed-check-divider.ts`, the file that legitimately OWNS the
       wording — so the absence assertion started failing on the one file that is supposed
       to contain it.
       The rule was never "absent from a file". It is "exactly one home", so that is what is
       counted now: a copy in the spine, in the refusal handler, or anywhere else fails,
       and the owner keeping it passes. A pin must not be widened until it always passes —
       here it is narrowed to what it always meant. */
    const owners = tsFilesUnder(ROOT, 'src/modules/webhook').filter((rel) =>
      readFileSync(join(ROOT, rel), 'utf8').includes(
        'ไม่พบข้อมูลการลงทะเบียนของสมาชิก',
      ),
    );
    expect(owners).toEqual([
      'src/modules/webhook/hook-reply/suppressed-check-divider.ts',
    ]);
  });

  it('changes the divider only — the customer still gets the resolved text', () => {
    const branch = refusalBranch();
    // the send below still uses `text`, not the divider label
    expect(branch).toContain('const refusalMode = resolveRefusalReplyMode(');
    /* [FEAT-20260828-PUSHCORE-A2] `sendTextReply` — the renamed receiver. A
       negative match against a name that no longer exists would pass for the
       wrong reason, which is the failure mode this whole file guards against. */
    expect(codeOnly()).not.toMatch(
      /sendTextReply\([\s\S]{0,160}ไม่พบข้อมูลการลงทะเบียนของสมาชิก/,
    );
  });

  it('leaves the card and its minted button alone', () => {
    /* [PROG-20260905-G19] THE DOOR NOW SPANS TWO FILES, so both halves are asserted.
       Before the extraction this was one call and one regex. The handler asks its
       collaborator with the RAW field and the RESOLVED mode; the spine binds that
       collaborator to the real builder, adding the hook and the LINE user id. Checking only
       the first half would let someone rebind the seat to the stripped text and stay green —
       which is the exact defect [FEAT-20260818-REFUSEDHELPERFLEX] was written for. */
    const code = codeOnly();
    expect(code).toMatch(/buildHookHelperFlexFor\(refusalRaw, refusalMode\)/);
    /* 🔴 The `ctx.` prefix is OPTIONAL here as of 05/09, and this is a fold rather than a
       widening. The binding moved from the refusal's own deps literal into `turnDeps()`,
       which is handed the turn context and therefore reads `ctx.hook` and
       `ctx.event.source?.userId` — the same two values under the name the ladder gives
       them. Everything the rule is about still has to hold: the RAW field goes in, and
       the hook and the LINE user id are added by the binding, in that order. The same
       fold was already applied to `this.`/`deps.` at SP22 for the same reason.
       ค่าตัวเดิม แค่เรียกผ่านชื่ออื่น ไม่ใช่ผ่อนกฎ */
    expect(code).toMatch(
      /buildHookHelperFlexFor:\s*\(raw, mode\)\s*=>[\s\S]{0,80}buildHookHelperFlexFor\(\s*raw,\s*(?:ctx\.)?hook,\s*(?:ctx\.)?event\.source\?\.userId,\s*mode/,
    );
  });
});
