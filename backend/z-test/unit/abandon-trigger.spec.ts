/**
 * [FEAT-20260820-ABANDONTRIGGER] "was asked to register and kept talking"
 * ===========================================================================
 * Owner (2026-08-20): "ถ้าในประวัติ 3 อันล่าสุดมี customer helper → อัพเดทค่า member
 * config.follow_up.line.abandon_trigger_at" · "ซ้ำค่านี้ไม่ได้ใน webhook ถ้ามีค่าแล้ว" ·
 * "การเคลียร์จะทำที่อื่น ยังไม่ใส่เงื่อนไขตอนนี้ แต่ต้องเพิ่มแบบง่าย ๆ".
 *
 * This replaces the retired alert: nothing interrupts anybody, a member simply
 * carries a date. The failures worth guarding are therefore not "did it chime"
 * but "did it stamp the wrong people", "did the timestamp move", and "did a
 * stuck customer's repeat messages cost a query every time".
 */
import { readFileSync } from 'node:fs';

import { MemberSchema } from '@/modules/chat/schemas/member.schema';
import { join } from 'node:path';

import {
  ABANDON_BOT_LOOKBACK,
  ABANDON_TRIGGER_KEY,
  CUSTOMER_HELPER_REPLY_TYPE,
  replyTypeOf,
  shouldStampAbandonTrigger,
  stampAbandonTriggerOnce,
  wasSentRegistrationCard,
} from '@/modules/webhook/follow-up';

import { spineSource } from '../lib/spine-sources';

const src = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');
const card = { metadata: { auto_reply_type: CUSTOMER_HELPER_REPLY_TYPE } };
const plainBot = { metadata: { auto_reply_type: 'payment_reply' } };

describe('the rule — pure, no database', () => {
  it('the card is recognised by the marker a REAL row carries', () => {
    expect(CUSTOMER_HELPER_REPLY_TYPE).toBe('flex_customerhelper');
    expect(replyTypeOf(card)).toBe('flex_customerhelper');
  });

  it('reads the marker whether it is nested or already flattened', () => {
    expect(replyTypeOf({ auto_reply_type: CUSTOMER_HELPER_REPLY_TYPE })).toBe(
      'flex_customerhelper',
    );
  });

  it('the card anywhere in the window counts', () => {
    expect(wasSentRegistrationCard([plainBot, card, plainBot])).toBe(true);
    expect(shouldStampAbandonTrigger([plainBot, card])).toBe(true);
  });

  it('no card means no stamp — an ordinary bot conversation is not a follow-up', () => {
    expect(shouldStampAbandonTrigger([plainBot, plainBot, plainBot])).toBe(
      false,
    );
  });

  it.each([[], null, undefined])('empty history (%p) is not a stamp', (h) => {
    expect(shouldStampAbandonTrigger(h as never)).toBe(false);
  });

  it('the window is three, and the number lives in exactly one place', () => {
    expect(ABANDON_BOT_LOOKBACK).toBe(3);
    const rule = src('src/modules/webhook/follow-up/abandon-trigger.rule.ts');
    // pinned as a literal so a change has to be deliberate, not incidental
    expect(rule).toContain('export const ABANDON_BOT_LOOKBACK = 3;');
  });
});

describe('the stamp — what it reads, what it writes, what it costs', () => {
  const makeDeps = (rows: unknown[], modifiedCount = 1) => {
    const find = jest.fn().mockReturnValue({
      sort: () => ({
        limit: (n: number) => {
          (find as unknown as { limitArg?: number }).limitArg = n;
          return {
            select: (proj: string) => {
              (find as unknown as { selectArg?: string }).selectArg = proj;
              return { lean: () => ({ exec: () => Promise.resolve(rows) }) };
            },
          };
        },
      }),
    });
    const updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount }),
    });
    return {
      deps: {
        chatMessageModel: { find } as never,
        memberModel: { updateOne } as never,
        warn: jest.fn(),
      },
      find,
      updateOne,
    };
  };
  const base = {
    hasProfile: false,
    room: { _id: 'r1' },
    member: {},
    channelUserId: 'Uabc',
  };

  const setOf = (call: unknown[]): Record<string, unknown> =>
    (call[1] as { $set: Record<string, unknown> }).$set;

  it('owns ONE key — level 2 lives in its own file with its own condition', () => {
    expect(ABANDON_TRIGGER_KEY).toBe('follow_up.line.abandon_trigger_at');
  });

  it('⭐ being marked before is NOT part of level 1 any more', () => {
    /* [FEAT-20260820-L1PURE] this case used to assert the opposite — that an
       already-marked customer cost ZERO queries, because the helper checked the
       mark and returned early. The owner narrowed level 1 to exactly two
       conditions on 2026-08-20: no raw profile, and the card in recent history.
       Nothing about having been marked before.

       ⚠️ NO BEHAVIOUR CHANGED IN THE WEBHOOK. `follow-up.gate.ts` still checks
       the mark first and routes a marked customer to level 2, so this function is
       never reached with one. What the removal bought is that the rule reads as
       the two conditions it actually is, in one file instead of two.
       เงื่อนไขเหลือสองข้อจริง ๆ · gate ยังกันไว้ให้เหมือนเดิม.

       The source is asserted rather than the behaviour, because the behaviour is
       deliberately unchanged — only the reason for it moved. */
    const src = readFileSync(
      join(
        process.cwd(),
        'src/modules/webhook/follow-up/abandon-trigger.helper.ts',
      ),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src).not.toContain('readMemberConfig(');
    // and the gate still holds the line for the webhook
    const gate = readFileSync(
      join(process.cwd(), 'src/modules/webhook/follow-up/follow-up.gate.ts'),
      'utf8',
    );
    expect(gate).toContain('handOffToRegister: true');
    expect(gate).toContain('ABANDON_TRIGGER_KEY');
  });

  it('writes ONE key and nothing else', async () => {
    const { deps, updateOne } = makeDeps([card]);
    await stampAbandonTriggerOnce(base, deps);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(Object.keys(setOf(updateOne.mock.calls[0]))).toEqual([
      'config.follow_up.line.abandon_trigger_at',
    ]);
  });

  it('stamps a member whose recent bot history holds the card', async () => {
    const { deps, updateOne } = makeDeps([plainBot, card]);
    expect(await stampAbandonTriggerOnce(base, deps)).toEqual({
      matched: true,
      stamped: true,
    });
    const [filter] = updateOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter['line_user_id']).toBe('Uabc');
    expect(
      setOf(updateOne.mock.calls[0])[
        'config.follow_up.line.abandon_trigger_at'
      ],
    ).toBeInstanceOf(Date);
  });

  /* [FEAT-20260820-STARTREGISTER] the second key. The pair is only useful if the
     two are written DIFFERENTLY — one pinned to the first occurrence, one moving
     with the latest. Written the same way they would be two copies of one fact. */

  it('the write is first-writer-wins, so the date never moves', async () => {
    const { deps, updateOne } = makeDeps([card]);
    await stampAbandonTriggerOnce(base, deps);
    const [filter] = updateOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter['$or']).toEqual([
      { 'config.follow_up.line.abandon_trigger_at': { $exists: false } },
      { 'config.follow_up.line.abandon_trigger_at': null },
    ]);
  });

  it('looks at the BOT’s last three messages only, and reads two small fields', async () => {
    /* ⚠️ THIS CASE SAID "one field" UNTIL 2026-08-21 AND WENT RED ON PURPOSE.
       [FIX-20260821-SLIPHELPERMARK] added `metadata.flex_doc_id`, which is what
       separates a legacy slip-refusal row that DID send a card from one that
       sent plain text, and what the bound-id rule matches on. Widening a
       projection is a real cost, so it is asserted rather than assumed — the
       card BODY (`flex_json`) is still NOT fetched, which is where the bytes
       would have been. ยังเป็น projection เล็ก ๆ บน room_id ที่มี index. */
    const { deps, find } = makeDeps([card]);
    await stampAbandonTriggerOnce(base, deps);
    /* [FIX-20260822-NOTICEHARDEN] a third condition joined the query on 22/08,
       owner-approved: a deposit/withdraw SCREENING reply (`flex_notice_*`)
       answers a different question from "was this customer handed the
       registration card?", so it must not occupy one of the three slots —
       three screening cards in a row used to push the registration card out of
       the window and the stamp was then never written. The prefix list lives
       in `abandon-trigger.rule.ts` (ABANDON_SKIPPED_REPLY_PREFIXES) and is
       pluggable: empty it, or pass `deps.skippedReplyPrefixes`, and this
       expectation returns to the two keys it had before, byte for byte.
       เงื่อนไขที่สามเพิ่มมาเพื่อไม่ให้การ์ด screening เบียดการ์ดลงทะเบียน. */
    expect(find).toHaveBeenCalledWith({
      room_id: 'r1',
      sender_type: 'bot',
      'metadata.auto_reply_type': { $not: /^(flex_notice_)/ },
    });
    expect((find as unknown as { limitArg?: number }).limitArg).toBe(3);
    expect((find as unknown as { selectArg?: string }).selectArg).toBe(
      'metadata.auto_reply_type metadata.flex_doc_id',
    );
    expect((find as unknown as { selectArg?: string }).selectArg).not.toContain(
      'flex_json',
    );
  });

  it('no card in the window → reads, then writes nothing', async () => {
    const { deps, updateOne } = makeDeps([plainBot, plainBot, plainBot]);
    expect(await stampAbandonTriggerOnce(base, deps)).toEqual({
      matched: false,
      stamped: false,
    });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('the rule still MATCHED when another message won the write', async () => {
    /* the caller answers on `matched`, so a customer whose message lost the race
       is still asked for their details. ตอบทุกคนที่เข้ากติกา. */
    const { deps } = makeDeps([card], 0);
    expect(await stampAbandonTriggerOnce(base, deps)).toEqual({
      matched: true,
      stamped: false,
    });
  });

  it.each([
    ['no room', { ...base, room: null }],
    ['no customer id', { ...base, channelUserId: '' }],
  ])('%s → does nothing at all', async (_label, input) => {
    const { deps, find, updateOne } = makeDeps([card]);
    expect(await stampAbandonTriggerOnce(input as never, deps)).toEqual({
      matched: false,
      stamped: false,
    });
    expect(find).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('a database failure is swallowed — a customer reply must never break on this', async () => {
    const warn = jest.fn();
    const deps = {
      chatMessageModel: {
        find: () => {
          throw new Error('mongo down');
        },
      } as never,
      memberModel: {} as never,
      warn,
    };
    await expect(stampAbandonTriggerOnce(base, deps)).resolves.toEqual({
      matched: false,
      stamped: false,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('wiring — where it sits and what it must not do', () => {
  /* [PROG-20260905-SPINESRC] SP23 moved the flow's body to gates/follow-up-flow.ts. The
     rule here — the webhook AWAITS the gate rather than firing and forgetting, because
     levels 2 and 3 decide whether the bot answers at all — is about the call, and the
     call moved with the body. Reading both keeps the rule; reading only the spine would
     have retired it. */
  const wh =
    src('src/modules/webhook/webhook.service.ts') +
    src('src/modules/webhook/gates/follow-up-flow.ts');
  const schema = src('src/modules/chat/schemas/member.schema.ts');

  it('the webhook AWAITS the gate — the flow now depends on its verdict', () => {
    /* It used to be fire-and-forget, when all it did was bookkeeping. Levels 2
       and 3 decide whether the bot answers at all, so the result has to be in
       hand before the next branch runs. ต้องรอผล เพราะมันตัดสินว่าบอทจะตอบไหม. */
    expect(wh).toContain('const followUp = await runFollowUpGate(');
    expect(wh).not.toContain('void stampAbandonTriggerOnce(');
  });

  it('it reuses the room, the member and the profile verdict already computed', () => {
    expect(wh).toContain('hasProfile: followUpHasProfile,');
    expect(wh).toContain('room: inboundRoom,');
    expect(wh).toContain('member: existingUser,');
  });

  it('the retired ALERT stays retired — no chime, no event, no room field', () => {
    expect(wh).not.toContain("publish('room:abandon'");
    expect(wh).not.toContain('detectAbandonOnce');
    expect(schema).not.toContain('abandon_alerted_at');
  });

  it('a PARTIAL index backs the query nobody scopes by member id', () => {
    /* Read the real index definition off the schema, not the file's text: a
       first attempt asserted the word `partialFilterExpression` appeared
       somewhere and stayed green when the option was renamed to
       `XpartialFilterExpression` — the substring was still there. อ่านนิยามจริง. */
    const PATH = 'config.follow_up.line.abandon_trigger_at';
    const found = MemberSchema.indexes().find(([fields]) =>
      Object.prototype.hasOwnProperty.call(fields, PATH),
    );
    expect(found).toBeDefined();
    const [fields, options] = found as [
      Record<string, number>,
      Record<string, unknown>,
    ];
    /* keyed on the stamp itself — measured that a compound with `updated_at` still
       produced a SORT stage, because `$exists` on the leading field is a range. */
    expect(fields[PATH]).toBe(1);
    expect(fields['updated_at']).toBeUndefined();
    // partial, so the index grows with the number of stuck customers, not members
    expect(options['partialFilterExpression']).toEqual({
      [PATH]: { $exists: true },
    });
  });
});

/* harness สำหรับเคสของ B — makeDeps ตัวเดิมอยู่ใน describe อื่น ตัวนี้เก็บ selectArg ด้วย */
const makeDepsForB = (rows: unknown[], modifiedCount = 1) => {
  const find = jest.fn().mockReturnValue({
    sort: () => ({
      limit: () => ({
        select: (proj: string) => {
          (find as unknown as { selectArg?: string }).selectArg = proj;
          return { lean: () => ({ exec: () => Promise.resolve(rows) }) };
        },
      }),
    }),
  });
  const updateOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({ modifiedCount }),
  });
  return {
    deps: {
      chatMessageModel: { find } as never,
      memberModel: { updateOne } as never,
      warn: jest.fn(),
    },
    find,
    updateOne,
  };
};
const baseForB = {
  hasProfile: false,
  room: { _id: 'r1' },
  member: {},
  channelUserId: 'Uabc',
};

/* [FIX-20260821-SLIPHELPERMARK] the card sent by the SLIP path counts too
 * ===========================================================================
 * Reported from production 20/08 (log …19-46-38, member Uc1dae355…): a customer
 * sent a slip with no linked account, was answered WITH the customer-helper
 * card, typed "ยอดไม่เข้าคะ" five seconds later — and instead of entering the
 * abandon loop, got the same card again from the AI path.
 *
 * The card was sent. The history row for it said `slip_require_profile_text`,
 * because the slip-refusal branch names the row after the operator's TEXT field
 * even when what actually went out was the card. `wasSentRegistrationCard` had
 * one name to match and it was not that one, so level 1 read three bot rows,
 * found nothing, and returned NO — and with level 1 silent, level 2 could never
 * be earned either.
 *
 * ⚠️ THE ROOM WAS BRAND NEW. It was created by that same slip 8 seconds
 * earlier, so the refusal card was the ONLY bot row in the window. On an older
 * room a stray earlier card could have masked this for months.
 *
 * Two fixes, and BOTH are needed — measured, not assumed:
 *   A. the slip branch names the row `flex_customerhelper` when a card is what
 *      went out. Covers every OA.
 *   B. the rule also accepts a row whose `flex_doc_id` IS the OA's bound
 *      customer-helper card. Covers a FUTURE sender that forgets to name it —
 *      but ONLY for the 5 of 10 OAs that bind a card; the other 5 fall back to
 *      the hard-coded card and store `flex_doc_id: null`, which is exactly why
 *      B alone was rejected.
 */
describe('⭐ [FIX-20260821-SLIPHELPERMARK] A — the slip refusal names the row for what it sent', () => {
  /**
   * [PROG-20260905-G19] The branch this reads MOVED out of `webhook.service.ts` into
   * `hook-reply/unlinked-slip-refusal.handler.ts`. The rule did not: the refusal row must
   * still name what actually went out. So the reader follows the code instead of the file
   * — the spine PLUS the role directories a body may legitimately be extracted into.
   *
   * ⚠️ This is not a widening that makes the case easier to pass. The anchor
   * (`reason: 'slip_refused_no_profile'`) exists exactly once across all of them, and a
   * rule that holds nowhere still fails. What changed is only the assumption about WHERE
   * the code sits. ตามโค้ดไป ไม่ใช่ตามไฟล์
   */
  const refusalBranch = (): string => {
    const body = spineSource(join(__dirname, '../..'));
    const i = body.indexOf("reason: 'slip_refused_no_profile'");
    expect(i).toBeGreaterThan(0);
    return body.slice(i - 400, i + 3200);
  };

  it('⭐ names the row `flex_customerhelper` when a card went out', () => {
    /* Read from source rather than run the whole webhook: this is one ternary
       inside a 5,000-line method whose harness needs a live LINE event. The
       behaviour it feeds — the rule below — is exercised for real.

       ⚠️ ASSERT THE QUOTED VALUE, NOT THE BARE WORD. The first draft of this
       case used `toContain('flex_customerhelper')` and PASSED BEFORE THE FIX,
       because `flex_doc_id: hook['flex_customerhelper_id']` sits four lines
       below and contains that word. A red-first case that was never red proves
       nothing. คำว่า flex_customerhelper ซ่อนอยู่ใน flex_customerhelper_id. */
    expect(refusalBranch()).toContain(`'${CUSTOMER_HELPER_REPLY_TYPE}'`);
    expect(refusalBranch()).toMatch(/auto_reply_type:\s*refusalCard/);
  });

  it('⭐ still names it after the TEXT field when no card went out', () => {
    /* An OA with the reply mode off sends plain text. Calling that a card would
       start the abandon loop for a customer who was never handed one.
       ส่งข้อความล้วน ≠ ส่งการ์ด · ห้ามนับรวม. */
    expect(refusalBranch()).toContain("'slip_require_profile_text'");
    expect(refusalBranch()).toMatch(
      /refusalCard\s*\n?\s*\?\s*'flex_customerhelper'/,
    );
  });

  it('⭐ the webhook_log for the same send already made this distinction', () => {
    /* `refusalAction` has split card-vs-text since 19/08 (`_flex` suffix). The
       chat_messages row simply never got the same treatment — which is the
       whole bug, and the reason this fix is a rename and not a new concept. */
    // [PROG-20260905-G19] reads the spine plus its role directories — the refusal moved to
    // `hook-reply/unlinked-slip-refusal.handler.ts` and took this ternary with it.
    expect(spineSource(join(__dirname, '../..'))).toContain(
      "? 'slip_refused_no_profile_flex'",
    );
  });
});

describe('⭐ [FIX-20260821-SLIPHELPERMARK] B — the bound card is recognised by its id', () => {
  const BOUND = 'a0d000000000000000000015';
  const boundRow = {
    metadata: {
      auto_reply_type: 'slip_require_profile_text',
      flex_doc_id: BOUND,
    },
  };

  it('⭐ a row carrying the OA’s bound card id counts, whatever it is named', () => {
    expect(wasSentRegistrationCard([boundRow], BOUND)).toBe(true);
    expect(shouldStampAbandonTrigger([boundRow], BOUND)).toBe(true);
  });

  it('⭐ a DIFFERENT card id does not count', () => {
    /* `flex_doc_id` is shared with the profile card (`webhook.service.ts:4755`
       writes `flex_profile_id` into the same key), so matching on "has an id"
       would count a profile card as a registration card. */
    const other = {
      metadata: {
        auto_reply_type: 'flex_profile',
        flex_doc_id: 'a0d000000000000000000016',
      },
    };
    expect(wasSentRegistrationCard([other], BOUND)).toBe(false);
  });

  it('⭐⭐ null never matches null — the trap that would have fired for half the OAs', () => {
    /* 5 of 10 hooks bind no card: `hook.flex_customerhelper_id` is null AND the
       stored `flex_doc_id` is null, so a plain equality would call EVERY bot row
       a registration card. 609 rows in the dev database carry no such key at
       all. Measured 2026-08-21, not reasoned. */
    const noId = {
      metadata: { auto_reply_type: 'payment_reply', flex_doc_id: null },
    };
    const noKey = { metadata: { auto_reply_type: 'payment_reply' } };
    for (const bound of [null, undefined, '']) {
      expect(wasSentRegistrationCard([noId], bound)).toBe(false);
      expect(wasSentRegistrationCard([noKey], bound)).toBe(false);
      expect(shouldStampAbandonTrigger([noId, noKey], bound)).toBe(false);
    }
    expect(wasSentRegistrationCard([noId], BOUND)).toBe(false);
    expect(wasSentRegistrationCard([noKey], BOUND)).toBe(false);
  });

  it('⭐ ObjectId and string compare equal — the row is lean, the hook is not', () => {
    /* The history row comes back through `.lean()` so its id may be an
       ObjectId, while the value threaded from the hook may already be a string.
       เทียบคนละชนิดแล้วไม่ตรง = กติกาเงียบทั้งที่การ์ดออกไปจริง. */
    const asObjectId = { metadata: { flex_doc_id: { toString: () => BOUND } } };
    expect(wasSentRegistrationCard([asObjectId], BOUND)).toBe(true);
  });

  it('⭐⭐ แถวเก่าที่เขียนก่อนแก้ ยังต้องนับได้ — เจ้าของสั่ง "รองรับแบบเก่าด้วย ห้ามพัง"', () => {
    /* Rows written BEFORE this fix carry `slip_require_profile_text` even when a
       card went out, and they are not going to be rewritten. What tells them
       apart from a text-only refusal is that the card fields were written beside
       them: `webhook.service.ts` stores `flex_json` + `flex_doc_id` only inside
       `...(refusalCard && { … })`, so the KEY IS PRESENT iff a card was sent.
       Measured on the dev database 2026-08-21: 11 rows carry that name and NONE
       of them has the key — every one was a text-only refusal, so nothing here
       starts counting rows that should not count. On production the key does
       appear, because the card fields shipped 18/08 and the reported incident
       was 20/08. แถวเก่าที่มีการ์ดจริงต้องยังนับได้ ไม่งั้นคนที่ค้างอยู่หลุดหมด. */
    const legacyWithCard = {
      metadata: {
        auto_reply_type: 'slip_require_profile_text',
        flex_doc_id: null,
      },
    };
    const legacyTextOnly = {
      metadata: { auto_reply_type: 'slip_require_profile_text' },
    };
    expect(wasSentRegistrationCard([legacyWithCard], null)).toBe(true);
    expect(wasSentRegistrationCard([legacyTextOnly], null)).toBe(false);
    /* and it holds for an OA that DOES bind a card, where the id is a real one */
    expect(
      wasSentRegistrationCard(
        [
          {
            metadata: {
              auto_reply_type: 'slip_require_profile_text',
              flex_doc_id: 'a0d000000000000000000015',
            },
          },
        ],
        null,
      ),
    ).toBe(true);
  });

  it('⭐⭐ แถวแบบ flattened ก็ต้องอ่านออก ทั้งชื่อและคีย์การ์ด', () => {
    /* `replyTypeOf` รองรับแถวที่ถูก unwrap มาแล้วตั้งแต่ต้น ("nested หรือ
       flattened ก็อ่านได้") — ตัวอ่านคีย์การ์ดต้องรองรับเท่ากัน ไม่งั้นสองตัวนี้
       ไม่ตรงกันและรูจะอยู่ตรงที่ไม่มีใครมอง

       ⚠️ เคสนี้เกิดจาก mutation ที่ **หลุด**: เปลี่ยน `'flex_doc_id' in row` เป็น
       `row.flex_doc_id` แล้วเทสยังเขียวทั้งชุด เพราะทุกเคสที่มีอยู่ส่งแบบ nested
       หมด ⇒ ทางเดิน flattened ไม่เคยถูกเดินเลย
       ⚠️ และมันต้องเป็นการดู **คีย์** ไม่ใช่ค่า — OA ที่ไม่ผูกการ์ดเก็บ `null`
       ซึ่ง falsy แต่แปลว่า "การ์ดออกไปแล้ว" */
    const flatLegacyWithCard = {
      auto_reply_type: 'slip_require_profile_text',
      flex_doc_id: null,
    };
    const flatLegacyTextOnly = { auto_reply_type: 'slip_require_profile_text' };
    expect(wasSentRegistrationCard([flatLegacyWithCard], null)).toBe(true);
    expect(wasSentRegistrationCard([flatLegacyTextOnly], null)).toBe(false);

    const BOUND = 'a0d000000000000000000015';
    expect(
      wasSentRegistrationCard(
        [{ auto_reply_type: 'payment_reply', flex_doc_id: BOUND }],
        BOUND,
      ),
    ).toBe(true);
  });

  it('⭐ ชื่ออื่นที่บังเอิญมี flex_doc_id ไม่ถูกนับ — การ์ดโปรไฟล์ไม่ใช่การ์ดลงทะเบียน', () => {
    /* `webhook.service.ts:4755` writes `flex_profile_id` into the SAME key, so
       "has the key" alone is not the rule — it only rescues rows carrying the
       legacy slip name. */
    expect(
      wasSentRegistrationCard(
        [
          {
            metadata: {
              auto_reply_type: 'flex_profile',
              flex_doc_id: 'a0d000000000000000000017',
            },
          },
        ],
        null,
      ),
    ).toBe(false);
    expect(
      wasSentRegistrationCard(
        [
          {
            metadata: {
              auto_reply_type: 'slip_flex_reply',
              flex_doc_id: 'a0d000000000000000000018',
            },
          },
        ],
        null,
      ),
    ).toBe(false);
  });

  it('⭐ the name alone still works with no bound id — A carries the OAs B cannot', () => {
    expect(wasSentRegistrationCard([card], null)).toBe(true);
    expect(shouldStampAbandonTrigger([card], undefined)).toBe(true);
  });
});

describe('⭐ [FIX-20260821-SLIPHELPERMARK] B — what the query and the gate must carry', () => {
  it('⭐ the projection now also fetches the card id', async () => {
    const { deps, find } = makeDepsForB([card]);
    await stampAbandonTriggerOnce({ ...baseForB }, deps);
    expect((find as unknown as { selectArg?: string }).selectArg).toBe(
      'metadata.auto_reply_type metadata.flex_doc_id',
    );
  });

  it('⭐ a row named wrongly but carrying the bound id still stamps', async () => {
    const BOUND = 'a0d000000000000000000015';
    const row = {
      metadata: {
        auto_reply_type: 'slip_require_profile_text',
        flex_doc_id: BOUND,
      },
    };
    const { deps, updateOne } = makeDepsForB([row]);
    const res = await stampAbandonTriggerOnce(
      { ...baseForB, helperCardId: BOUND },
      deps,
    );
    expect(res).toEqual({ matched: true, stamped: true });
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('⭐ the gate hands the bound id down from the hook it already holds', () => {
    /* The gate reads `input.hook` for the ignore switch already, so B needs no
       new query and no new argument at the webhook. */
    const gate = src('src/modules/webhook/follow-up/follow-up.gate.ts');
    expect(gate).toContain('helperCardId: input.hook?.flex_customerhelper_id');
    /* declared on the gate's own input type rather than cast at the call site —
       a cast would have hidden a rename of the hook field. */
    expect(gate).toContain('flex_customerhelper_id?: unknown;');
  });
});
