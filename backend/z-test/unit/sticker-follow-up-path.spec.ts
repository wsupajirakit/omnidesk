/**
 * [FEAT-20260820-STICKERFOLLOWUP] a sticker reaches the abandon flow — and only it
 * ===========================================================================
 * Owner, 2026-08-20: "ห้าม sticker ไหลไปทางอื่น อนุญาตให้แค่มาหาเรา abandon เลเวล 2"
 * and immediately after: "เลเวล 1 ด้วย".
 *
 * WHAT WAS WRONG. `SILENT_MESSAGE_TYPES` (sticker/file/video/audio) returns from
 * the webhook roughly 250 lines ABOVE the follow-up gate, so a customer sitting in
 * the abandon flow could send stickers forever and neither level ever saw them.
 *
 * HOW IT IS FIXED — and why this file reads the source. The flow lives inside a
 * ~4k-line private method that cannot be constructed in a unit test, so the
 * property that matters ("a sticker can reach the flow and NOTHING else") is a
 * property of the control flow, not of a return value. It is therefore asserted
 * against the real text, with comments stripped so a sentence in a comment can
 * never satisfy an assertion — that has fooled tests in this repo twice before.
 *
 * The behaviour on either side is covered elsewhere and deliberately not repeated:
 *   · what the gate decides            → `follow-up-gate.spec.ts`
 *   · what level 1 stamps              → `abandon-trigger.spec.ts`
 *   · what level 2 does with a message → `register-scenarios.spec.ts`
 *   · a sticker from a REGISTERED customer stays silent → `webhook-flow-matrix`
 *     case A10, which passes untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FULL_LADDER } from '../../src/modules/webhook/gates/ladder-order';

const SRC = 'src/modules/webhook/webhook.service.ts';

/** Comments stripped: an assertion must never be satisfied by prose. */
/* [PROG-20260905-SPINESRC] The follow-up gate's BODY moved to
   follow-up/follow-up-flow.ts at SP23; its binding stayed in the spine. Every rule below
   is about the gate's behaviour and holds wherever the body lives, so the source read here
   is the spine plus that role directory. Narrow list, not the whole module: a smaller list
   is a stronger assertion. */
/* [PROG-20260905-LADDER] and the normal-position CALL moved too: it is
   `gates/follow-up.step.ts` now, invoked through the customer slice. The silent-type gate
   still calls the closure directly, because a strike-plug hunk owns bytes inside it and it
   cannot become a step. Both call sites are read here, which is what keeps "exactly two"
   meaning what it has always meant. */
const source = (
  readFileSync(join(process.cwd(), SRC), 'utf8') +
  readFileSync(
    join(process.cwd(), 'src/modules/webhook/gates/follow-up-flow.ts'),
    'utf8',
  ) +
  readFileSync(
    join(process.cwd(), 'src/modules/webhook/gates/follow-up.step.ts'),
    'utf8',
  )
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

/** The whole `if (silent type) { ... }` block, braces balanced. */
function silentGateBlock(): string {
  const at = source.indexOf('SILENT_MESSAGE_TYPES.includes(');
  expect(at).toBeGreaterThan(-1);
  const open = source.indexOf('{', source.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced silent-type gate');
}

describe('⭐ the follow-up flow exists exactly once', () => {
  it('one definition — the block was lifted, not copied', () => {
    /* a copy would drift: two gates, two level-1 stamps, two ways to open a case.
       ยกมาไม่ใช่ก๊อป. */
    /* [PROG-20260905-SPINESRC] SP23 moved the body to gates/follow-up-flow.ts, where the
       definition is an exported function rather than a closure, and the spine keeps a
       single binding of the same name. The RULE is unchanged and is the reason this case
       exists: exactly ONE definition, because a copy drifts into two gates, two level-1
       stamps and two ways to open a case. Counting both spellings keeps that rule true
       across the move and still fails on a copy. */
    const definitions =
      source.split('const runFollowUpFlow = async').length -
      1 +
      source.split('export async function runFollowUpFlow(').length -
      1;
    expect(definitions).toBe(1);
    expect(source.split('runFollowUpGate(').length - 1).toBe(1);
  });

  it('and it is called from exactly two places', () => {
    /* [PROG-20260905-LADDER] the two sites now spell it differently — the silent-type gate
       still calls the closure (`runFollowUpFlow()`), the normal position calls it through
       the ladder's deps (`deps.runFollowUpFlow()`). The RULE is the count, not the
       spelling: two places, because a third would mean a sticker could reach the flow by
       a path nobody drew. */
    const direct = source.split('runFollowUpFlow()').length - 1;
    expect(direct).toBe(2); // `deps.runFollowUpFlow()` contains `runFollowUpFlow()`
  });
});

describe('⭐ a sticker can reach it', () => {
  const block = silentGateBlock();

  it('the silent-type gate runs the flow', () => {
    expect(block).toContain('await runFollowUpFlow();');
  });

  it('only for a customer who has no raw profile', () => {
    /* the flow can only ever concern those customers, so everyone else keeps the
       old path exactly — no gate call, no extra read, no write. */
    expect(block).toMatch(/!\s*followUpHasProfile/);
  });

  it('and not while an admin is holding the room', () => {
    /* today a sticker in a claimed room is silent; that half must not change. */
    expect(block).toMatch(/!\s*skipBotProcessing/);
  });
});

describe('⭐ and it can reach NOTHING else', () => {
  const block = silentGateBlock();

  it('the gate still returns unconditionally, at the end', () => {
    /* THE load-bearing assertion. The sticker is stopped by the absence of a
       path, not by a stack of guards — so if this return ever moves inside a
       branch, a sticker starts falling through to the limiter, the keyword
       handler, the AI and the non-text branch. หยุดเพราะไม่มีทางไป. */
    const tail = block.trimEnd();
    expect(tail.endsWith('return;\n          }')).toBe(true);
  });

  it('the gate answers nobody — it CHARGES the window, and nothing more', () => {
    /* [FEAT-20260821-RATELADDER] Owner, 21/08: "รวมทั้ง text + sticker + image + vdo
       (ทุก event)" + "นับ แต่เงียบเหมือนเดิม". The charge moved INTO this gate,
       so `rateLimit`/`consume(` are no longer forbidden here — they are required
       (next case). Everything that would ANSWER a sticker is still forbidden:
       the customer's phone sees exactly what it saw before. */
    /* [FEAT-20260828-PUSHCORE-A2] the first two names were renamed to
       `sendTextReply` / `sendFlexReply`. Leaving the OLD names here would have
       been the worst possible outcome: the assertions would still pass, while
       forbidding strings that no longer appear anywhere in the file — a guard
       that cannot fail. Both spellings are listed so the rule holds whichever
       sender a future edit reaches for. ห้ามปล่อยให้ negative assertion กลายเป็นของว่าง */
    for (const forbidden of [
      'sendTextReply',
      'sendFlexReply',
      'sendLineReplyMessage',
      'sendLineFlexReply',
      'aiReply',
      'isCustomerRegisterKeyword',
    ]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it('[RATELADDER] it charges the window exactly once, with the message type, and never answers', () => {
    expect(block.split('this.rateLimit.consume(').length - 1).toBe(1);
    expect(block).toMatch(
      /this\.rateLimit\.consume\(\s*event\.source\.userId,\s*event\.message\.type,?\s*\)/,
    );
    // the verdict is only logged — no branch sends anything on `limited`
    const afterConsume = block.slice(block.indexOf('this.rateLimit.consume('));
    // [FEAT-20260828-PUSHCORE-A2] `send(Text|Flex)Reply` covers the renamed
    // senders; `sendLine` stays for the legacy names, so neither can slip in.
    expect(afterConsume).not.toMatch(
      /sendLine|sendTextReply|sendFlexReply|wlogEmit|replyToken/,
    );
  });

  it('the flow still runs where it always ran — below the assist branch', () => {
    /* an admin holding the room silences the bot from the next message; hoisting
       the flow above that branch would take the silence away. */
    /* [PROG-20260905-LADDER] the normal call is a ladder step now, so what has to sit
       below the assist branch is the SLICE that runs it. The rule is unchanged: an admin
       holding the room silences the bot from the next message, and hoisting the flow above
       that branch would take the silence away.

     * 🔴 CONVERTED AGAIN 05/09, AND IT GOT STRONGER RATHER THAN LOOSER. The previous
     *   version searched the spine for `if (skipBotProcessing) {`, because the assist
     *   branch was still inline and could not be named as a step. It is a step now
     *   (`assist-bypass`), so that string is gone and the search returned -1 — the case
     *   failed on a SPELLING while the rule itself was never in doubt.
     *
     *   Both sides are steps today, so the order is DATA, not a text offset: the check is
     *   now that `assist-bypass` precedes `follow-up` in the shipped ladder. That is the
     *   rule stated exactly, and it survives any future move of either call site.
     *   The spine half is kept as well — the two slice calls in file order — because the
     *   array order and the call order are separately maintained, and
     *   `gate-ladder-order.spec.ts` is what proves those two agree.
     *   สองฝั่งเป็นด่านแล้ว ลำดับเลยเป็นข้อมูล ไม่ใช่ตำแหน่งตัวอักษร */
    const ids = FULL_LADDER.map((step) => step.id);
    expect(ids).toContain('assist-bypass');
    expect(ids).toContain('follow-up');
    expect(ids.indexOf('assist-bypass')).toBeLessThan(ids.indexOf('follow-up'));

    const assist = source.indexOf('runLadder(ASSIST_BYPASS_LADDER');
    const call = source.lastIndexOf('runLadder(CUSTOMER_LADDER');
    expect(assist).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(assist);
  });

  it('the definition sits above the silent-type gate, or neither call compiles', () => {
    expect(source.indexOf('const runFollowUpFlow = async')).toBeLessThan(
      source.indexOf('SILENT_MESSAGE_TYPES.includes('),
    );
  });
});
