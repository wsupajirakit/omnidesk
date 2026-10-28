import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ==== [FIX-20260810-HELPERFLEXHISTORY] ====
 *
 * The bug: the customer received a customer-helper CARD, but chat history kept
 * the AI text and the [HELPERQR] block appended "ปุ่มลงทะเบียน quick reply" to
 * it. The admin panel therefore showed a text bubble while the customer had a
 * card — the two sides disagreed about what was sent.
 *
 * These are source-shape tests: the surrounding code is a ~3,000-line reply path
 * that cannot be instantiated without a live Mongo/LINE stack, and the sibling
 * suites that DO boot it are the pre-existing red ones needing a real
 * DatabaseConnection. What is asserted here is exactly what the fix changed —
 * the two guards and the mirrored payload.
 *
 * ⚠️ บทเรียนรอบก่อน: เทสที่อ่าน source ต้อง **ตัดคอมเมนต์ออกก่อน** ไม่งั้นไป
 *    แมตช์ประโยคในคอมเมนต์ที่อธิบายของเดิม แล้วเขียว/แดงผิดตัว.
 */

const WEBHOOK = join(__dirname, '..', '..', 'src', 'modules', 'webhook');

/**
 * [PROG-20260905-CENSUSCONV] Where the history-rewrite code may live.
 *
 * Every assertion below still holds and still means what it meant: the row must store the
 * card that was SENT, tag it so each kind stays distinguishable, point `flex_doc_id` at the
 * bound card, and publish the same card it stored. Those are behaviour rules, and they are
 * equally true wherever the code sits.
 *
 * What changed is only the reading. The reduction program moves bodies into role
 * directories; pinned to the service alone this file would go red the day the rewrite
 * moves, for a change that altered nothing — and a spec that reddens on safe changes gets
 * deleted, which would cost the rules it protects. A directory that does not exist yet is
 * skipped, because census lists name directories later steps create.
 */
const HISTORY_SOURCES: readonly string[] = [
  'webhook.service.ts',
  'post-send',
  'hook-reply',
  'flex',
  /* [PROG-20260905-G45] `ai-reply` joined the list when the AI send and the two history
     rewrites that follow it moved into `ai-reply/send-ai-reply.handler.ts`. This is the
     mechanism the header above describes working exactly as intended: the rules did not
     change, the reading did. A list that has to grow when code moves is the cost of
     pinning source text at all — and it is cheaper than losing the rules. */
  'ai-reply',
];

/** Source with every comment removed, so assertions can only match real code. */
function codeOnly(): string {
  const parts: string[] = [];
  for (const entry of HISTORY_SOURCES) {
    const abs = join(WEBHOOK, entry);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs).sort()) {
        if (f.endsWith('.ts')) parts.push(readFileSync(join(abs, f), 'utf8'));
      }
    } else {
      parts.push(readFileSync(abs, 'utf8'));
    }
  }
  return parts
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('[FIX-20260810-HELPERFLEXHISTORY] admin history stores the helper card', () => {
  const code = codeOnly();

  it('does not append the quick-reply note when a helper card was sent', () => {
    // The note is only truthful on the quick-reply route. With a card, the
    // buttons are ON the card and the flex block below owns the row.
    expect(code).toContain(
      'if (useHelperQr && !helperFlexContents && botChatMsg?._id)',
    );
  });

  it('still appends the note on the quick-reply route (behaviour preserved)', () => {
    // The tag fired but no card could be built — legacy behaviour must remain.
    expect(code).toContain('ปุ่มลงทะเบียน quick reply');
  });

  it('rewrites history to flex for the helper card, not only the profile card', () => {
    expect(code).toContain(
      'if ((flexProfileContents || helperCardForHistory) && botChatMsg?._id)',
    );
  });

  it('gives the profile card precedence, mirroring the send order', () => {
    /* Send order at the reply site is profile → helper → text. History must store
       whichever card the customer actually received.

       ⚠️ [PROG-20260905-G45] MATCHED AS A SHAPE, NOT AS INDENTED BYTES. This asserted the
       ternary with its exact 12-space wrapping, so when the block moved into
       `ai-reply/send-ai-reply.handler.ts` — one nesting level shallower, and short enough
       for one line — it failed on whitespace while the rule it protects was untouched. A
       pin that fails on indentation teaches people to delete pins. */
    expect(code).toMatch(
      /const helperCardForHistory = flexProfileContents\s*\?\s*null\s*:\s*helperFlexContents;/,
    );
  });

  it('stores the card that was sent, not a hardcoded profile reference', () => {
    expect(code).toContain("'metadata.flex_json': historyCard");
    // The old code pinned flexProfileContents into the $set; that is what made
    // the helper card unstorable.
    expect(code).not.toContain("'metadata.flex_json': flexProfileContents");
  });

  it('tags the row so EVERY card kind stays distinguishable — one derivation, read by $set and publish', () => {
    /* [FIX-20260822-FLEXHISTORYTYPE] the two-way ternary (helper / "everything
       else") labelled every flex_m / flex_pc card "flex_profile". The label now
       comes from flexHistoryMeta (pinned in flex-history-meta.spec.ts), and the
       $set and the realtime publish read the SAME value. */
    expect(code).toContain('const flexHist = flexHistoryMeta({');
    expect(code).toContain(
      "kind: helperCardForHistory ? 'helper' : (flexKind ?? 'profile')",
    );
    expect(code).toContain(
      "'metadata.auto_reply_type': flexHist.auto_reply_type",
    );
    expect(code).toContain('auto_reply_type: flexHist.auto_reply_type');
    expect(code).not.toContain(
      "? 'flex_customerhelper'\n                          : 'flex_profile'",
    );
  });

  it('points flex_doc_id at the bound helper card when that is what was sent', () => {
    expect(code).toContain("hook?.['flex_customerhelper_id']");
  });

  it('publishes the SAME card it stored — screen and DB must not disagree', () => {
    // A realtime payload still carrying flexProfileContents would make the live
    // row differ from what a refresh loads.
    expect(code).toContain('flex_json: historyCard');
    expect(code).not.toContain('flex_json: flexProfileContents');
  });
});

/* ==== [FIX-20260821-ROOMPREVIEW] the room list must not quote what was thrown away
 * ===========================================================================
 * The bug: `chat_rooms.last_message.text` is written at `webhook.service.ts:4096`
 * from `replyText` — the AI's RAW answer, marker and all. About 380 lines later
 * `:4471-4475` throws that whole answer away and sends `customer_helper_text` as
 * a CARD instead. The chat_messages row is patched to match (`:4804`), the room
 * row is not, and there is only ONE place in the whole backend that writes
 * `last_message` (`chat/chat-history.service.ts:358-374`) — so nothing ever
 * corrects it.
 *
 * What an admin sees: the left-hand list quotes a polite paragraph the customer
 * NEVER RECEIVED, with `[[[customer-helper]]]` still hanging off the end, and
 * reads it as "already answered". Opening the room shows a registration card.
 *
 * ⚠️ WHY IT MATTERS MORE THAN IT LOOKS: the wrong text is overwritten by the
 * next message, so the symptom only persists while the card IS the last thing
 * said — which is exactly the customer who was asked to register and went quiet.
 * The rooms that stay wrong are the rooms that most need chasing.
 * ห้องที่ค้างผิด = ห้องที่ต้องตามที่สุดพอดี.
 *
 * ⚠️ MEASURED, NOT ASSUMED (dev database, 2026-08-21):
 *   `chat_messages` whose content starts with `[Flex]`  → 52
 *   `chat_rooms` whose last_message.text starts with it →  0
 *
 * ⚠️ SCOPE, DELIBERATELY: this fixes the STORED value. An admin already staring
 * at the list keeps the stale line until a refetch, because the FE has no
 * `message:updated` branch at all (grep in `pages/chat/` = 0) — the backend has
 * published that event since 2026-07 and nobody listens. Adding a listener is an
 * FE change with its own surface; it is NOT smuggled in here. หน้าจอที่เปิดค้าง
 * ยังเห็นของเก่าจนกว่าจะโหลดใหม่ — จงใจไม่แตะ FE ในงานนี้.
 */
describe('⭐ [FIX-20260821-ROOMPREVIEW] the room preview is corrected with the message', () => {
  const code = codeOnly();

  /* ⚠️ ANCHOR ON REAL CODE, NOT ON A NAME THAT APPEARS EVERYWHERE.
     The first draft searched for `chatRoomModel` and matched the CONSTRUCTOR
     parameter 4,300 lines earlier, so every case failed while the fix was
     already in place — red for the wrong reason proves as little as green for
     the wrong reason. `historyContentForRow` exists only in this block, and
     `codeOnly()` has stripped the comments, so the tag cannot be used.
     เล็งให้ตรงบล็อก ไม่งั้นแดง/เขียวคนละเรื่องกับที่ตั้งใจวัด. */
  const block = (): string => {
    const i = code.indexOf('const historyContentForRow');
    expect(i).toBeGreaterThan(0);
    return code.slice(i, i + 3000);
  };

  it('⭐⭐ the room row is patched in the same chain as the message row', () => {
    /* Both writes hang off the same `categorySettled` chain, so the preview can
       never be corrected before the row it is previewing. */
    /* [PROG-20260905-CENSUSCONV] The collaborator PREFIX is not the rule. A body that
       moves to a role directory reaches its models through `deps.` instead of `this.`,
       and the rule — message row patched before the room row, both on the same chain —
       is untouched by that. Matching either prefix keeps the rule and drops the
       accidental dependency on where the code happens to live. */
    const b = block();
    const msgAt = b.search(/(?:this|deps)\.chatMessageModel/);
    const roomAt = b.search(/(?:this|deps)\.chatRoomModel/);
    expect(msgAt).toBeGreaterThan(-1);
    expect(roomAt).toBeGreaterThan(-1);
    expect(b).toContain("'last_message.text'");
    expect(msgAt).toBeLessThan(roomAt);
  });

  it('⭐⭐ it only overwrites while the OLD text is still the preview', () => {
    /* THE RACE, AND WHY THE FILTER IS THE GUARD. Between the row being logged
       and this patch running, the customer may have said something else — the
       preview would then be THEIR message, and stamping the card over it would
       erase a newer fact. Matching on the text being replaced means a moved
       preview matches nothing: no read-then-write, no window.
       ⚠️ Not `last_message.timestamp`: the value this code holds is the one it
       WROTE, and comparing it would need extra state threaded 400 lines. */
    const b = block().slice(block().search(/(?:this|deps)\.chatRoomModel/));
    expect(b).toMatch(/_id:\s*botRoomId/);
    expect(b).toMatch(/'last_message\.text':\s*replyText/);
  });

  it('⭐ the room gets the SAME string the message row got', () => {
    /* Two literals would be a second bug wearing the first one's clothes: the
       list and the bubble would disagree again, just differently. */
    const b = block();
    expect(b).toMatch(/content:\s*historyContentForRow/);
    expect(b).toMatch(
      /\$set:\s*\{\s*'last_message\.text':\s*historyContentForRow/,
    );
  });

  it('⭐ a failure here never breaks the reply', () => {
    /* The customer already has the card by now — same stance as the message
       patch beside it, and as every other history write on this path.

       ⚠️ TIED TO THIS `.exec()`, NOT "a catch somewhere near". The first draft
       looked for `/\.catch\(/` anywhere after `chatRoomModel` and SURVIVED the
       mutation that turned this very catch into `.then(` — because the realtime
       block a few lines further down has a catch of its own and the window
       reached it. Assert the pair, and the log line that can only be this one.
       ต้องมัดกับ .exec() ของห้องเอง ไม่งั้นไปเจอ catch ของบล็อกอื่นแล้วเขียวลอย ๆ. */
    const flat = block().replace(/\s+/g, ' ');
    expect(flat).toContain('.exec() .catch((err: Error) =>');
    expect(flat).toContain('[ROOMPREVIEW]');
  });

  it('⭐ the message patch itself is unchanged — no behaviour borrowed', () => {
    // [FIX-20260822-FLEXHISTORYTYPE] the type comes from the single derivation
    expect(code).toContain(
      "'metadata.auto_reply_type': flexHist.auto_reply_type",
    );
    expect(code).toContain("message_type: 'flex'");
  });
});
