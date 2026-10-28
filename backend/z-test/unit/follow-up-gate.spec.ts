/**
 * [FEAT-20260820-FOLLOWUP] the gate — which level a message falls into
 * ===========================================================================
 * Owner (2026-08-20): every level also requires the customer to have NO raw
 * profile · "ถ้าเจอลูกค้ามี raw profile = เคลียร์สองค่านั้นออกทันที ลูกค้าจะจบ loop ทันที" ·
 * level 2 replies and cuts the flow · level 3 hands off and cuts the flow ·
 * "ทุกอย่างถ้าถอด abandon ออกต้องทำงานเหมือนเดิม".
 *
 * The gate itself must stay a pure verdict: it sends nothing, replies to nobody
 * and stops no flow. These tests pin that, the order of the levels, and the one
 * property the whole design rests on — a customer matches exactly one level.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runFollowUpGate } from '@/modules/webhook/follow-up';
/* [PROG-20260905-LADDER] the ladder's own order — the runtime order, and the one
   `gate-ladder-order.spec.ts` proves consistent with every declared constraint. */
import { CUSTOMER_LADDER } from '@/modules/webhook/gates/ladder-order';

const src = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');
const AT = 'abandon_trigger_at';
const member = (line: Record<string, unknown>) => ({
  config: { follow_up: { line } },
});
const D1 = new Date('2026-08-01T00:00:00.000Z');

const makeDeps = (botRows: unknown[] = [], modifiedCount = 1) => {
  const find = jest.fn().mockReturnValue({
    sort: () => ({
      limit: () => ({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(botRows) }),
        }),
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
const card = { metadata: { auto_reply_type: 'flex_customerhelper' } };
const base = { room: { _id: 'r1' }, channelUserId: 'Uabc' };

describe('which level a message falls into', () => {
  it('registered customer → nothing applies, and the mark is removed', async () => {
    const { deps, updateOne, find } = makeDeps([card]);
    const v = await runFollowUpGate(
      { ...base, hasProfile: true, member: member({ [AT]: D1 }) },
      deps,
    );
    expect(v).toEqual({
      memberNeedRegister: false,
      handOffToRegister: false,
      cleared: true,
    });
    expect(updateOne).toHaveBeenCalledTimes(1); // one $unset, one key
    expect(find).not.toHaveBeenCalled();
  });

  it('registered customer with nothing to clear costs no write', async () => {
    const { deps, updateOne } = makeDeps();
    const v = await runFollowUpGate(
      { ...base, hasProfile: true, member: {} },
      deps,
    );
    expect(v.cleared).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('already marked → level 2: hand off, read nothing, write nothing', async () => {
    const { deps, find, updateOne } = makeDeps([card]);
    const v = await runFollowUpGate(
      { ...base, hasProfile: false, member: member({ [AT]: D1 }) },
      deps,
    );
    expect(v.handOffToRegister).toBe(true);
    expect(v.memberNeedRegister).toBe(false);
    expect(find).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('not marked + card in the recent bot history → level 1: mark AND ask', async () => {
    const { deps, find, updateOne } = makeDeps([card]);
    const v = await runFollowUpGate(
      { ...base, hasProfile: false, member: {} },
      deps,
    );
    expect(v.memberNeedRegister).toBe(true);
    expect(v.handOffToRegister).toBe(false);
    expect(find).toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('the customer is asked even when another message won the write', async () => {
    /* two messages arriving together both match the rule; only one stamps. Both
       customers are the same person and both messages must be answered. */
    const { deps } = makeDeps([card], 0);
    const v = await runFollowUpGate(
      { ...base, hasProfile: false, member: {} },
      deps,
    );
    expect(v.memberNeedRegister).toBe(true);
  });

  it('not marked and no card → completely quiet, bot behaves as always', async () => {
    const { deps, updateOne } = makeDeps([
      { metadata: { auto_reply_type: 'payment_reply' } },
    ]);
    const v = await runFollowUpGate(
      { ...base, hasProfile: false, member: {} },
      deps,
    );
    expect(v).toEqual({
      memberNeedRegister: false,
      handOffToRegister: false,
      cleared: false,
    });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('no customer id → quiet, and nothing is touched', async () => {
    const { deps, find, updateOne } = makeDeps([card]);
    const v = await runFollowUpGate(
      {
        ...base,
        channelUserId: '',
        hasProfile: false,
        member: member({ [AT]: D1 }),
      },
      deps,
    );
    expect(v.handOffToRegister).toBe(false);
    expect(find).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('exactly one outcome ever fires — the verdict can never say two things', async () => {
    const cases = [
      { hasProfile: true, member: member({ [AT]: D1 }) },
      { hasProfile: false, member: member({ [AT]: D1 }) },
      { hasProfile: false, member: {} },
    ];
    for (const c of cases) {
      const { deps } = makeDeps([card]);
      const v = await runFollowUpGate({ ...base, ...c }, deps);
      const fired = [
        v.memberNeedRegister,
        v.handOffToRegister,
        v.cleared,
      ].filter(Boolean).length;
      expect(fired).toBe(1);
    }
  });
});

describe('the gate stays a verdict, and the webhook stays removable', () => {
  const gate = src('src/modules/webhook/follow-up/follow-up.gate.ts');
  /* [PROG-20260905-SPINESRC] The follow-up gate's BODY moved to
   follow-up/follow-up-flow.ts at SP23; its binding stayed in the spine. Every rule below
   is about the gate's behaviour and holds wherever the body lives, so the source read here
   is the spine plus that role directory. Narrow list, not the whole module: a smaller list
   is a stronger assertion. */
  /** The spine alone — for assertions about POSITION in the ladder. */
  const SPINE = src('src/modules/webhook/webhook.service.ts');
  const wh =
    src('src/modules/webhook/webhook.service.ts') +
    src('src/modules/webhook/gates/follow-up-flow.ts');

  it('the gate itself sends nothing and stops nothing', () => {
    for (const forbidden of [
      'lineApi',
      'sendLineReply',
      'realtimePublisher',
      'chatHistory',
    ]) {
      expect(gate).not.toContain(forbidden);
    }
  });

  it('level 2 answers the customer and stops the flow', () => {
    expect(wh).toContain('if (followUp.memberNeedRegister) {');
    expect(wh).toContain('FOLLOW_UP_REGISTER_ASK_TEXT');
  });

  it('level 3 hands off, says nothing, and stops the flow', () => {
    expect(wh).toContain('if (followUp.handOffToRegister) {');
    expect(wh).toContain('handoffToRegister(');
  });

  /* [PROG-20260905-LADDER] ⚠️ ALL THREE POSITION CASES BELOW WERE ABOUT TO MEASURE THE
     WRONG THING. They anchored on `SPINE.indexOf('await runFollowUpFlow()')` — and after
     the normal-position call became a ladder step, the FIRST match in the spine is the
     SILENT-TYPE gate's call, which is a different site with a different position. All
     three would have kept passing while checking a rule nobody wrote.

     The cut that these rules are about is the NORMAL position, which is now
     `gates/follow-up.step.ts` running inside the customer slice. So the anchor is the
     slice's call site, and the follow-up-vs-register ordering — both of them steps now —
     is asserted against the ladder ARRAY, which is the runtime order and is itself proven
     consistent by `gate-ladder-order.spec.ts`. อย่าให้เทสเขียวโดยวัดผิดจุด */
  const sliceCall = (): number => {
    const at = SPINE.indexOf('runLadder(CUSTOMER_LADDER');
    expect(at).toBeGreaterThan(0);
    return at;
  };
  const orderOf = (id: string): number => {
    const at = CUSTOMER_LADDER.findIndex((s) => s.id === id);
    expect(at).toBeGreaterThan(-1);
    return at;
  };

  it('the cut is BELOW the message store — the dashboard sees every message', () => {
    /* whatever the gate decides, the customer's message is already stored and
       published, so the chat list behaves identically. */
    /* [PROG-20260905-SPINESRC] The POSITION rule is about where the flow is CUT in the
       ladder, and the cut is the call site — which is still in the spine. The gate's body
       moved to a role file at SP23, so anchoring on `runFollowUpGate(` now points into a
       different file and comparing offsets across a concatenation means nothing. Anchored
       on the spine's own call, the rule reads exactly as it always did.
       ⚠️ The store anchor was ALSO stale, and not because of this cut: SP18 replaced the
       inline `chatHistory.logMessage({` with `storeInboundChatRow(`, and this case was not
       run then. Both anchors are now the live ones. */
    const storeMsg = SPINE.indexOf('customerMsg = (await storeInboundChatRow(');
    expect(storeMsg).toBeGreaterThan(0);
    expect(sliceCall()).toBeGreaterThan(storeMsg);
  });

  it('the cut is ABOVE the customer-register keyword — owner’s call, 2026-08-20', () => {
    /* Once a customer is in level 2 or 3 this flow owns the conversation, so the
       old self-service link must not intercept. The consequence is deliberate and
       recorded: that keyword is no longer a way out — gaining a real profile is,
       and the gate clears both marks on the next message.
       ทางออกคือ raw profile ไม่ใช่คีย์เวิร์ด. */
    // Both are steps now, so the ladder array IS the order — and it is the runtime order.
    expect(orderOf('follow-up')).toBeLessThan(orderOf('customer-register'));
  });

  it('the cut is ABOVE the non-text branch, so images are cut too', () => {
    const nonText = SPINE.indexOf(
      "if (event.type === 'message' && event.message?.type !== 'text') {",
    );
    expect(nonText).toBeGreaterThan(0);
    expect(sliceCall()).toBeLessThan(nonText);
  });
});
