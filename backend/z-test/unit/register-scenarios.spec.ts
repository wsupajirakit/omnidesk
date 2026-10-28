/**
 * [FEAT-20260820-SCENARIOS] level 2 hands over to ONE scenario, chosen by the caller
 * ===========================================================================
 * Owner: "choose scenario A ว่าง · scenario B prompt → รับ response ai · scenario C ว่าง ·
 * scenario D เพิ่มได้ >> ทุกตัวอิสระแยกกันและเลือกได้ · ปัจจุบันให้เลือก A ·
 * ใครเป็นคนบอกว่าเลือก A คือ webhook ตอนที่ trigger เลเวลสองทำงาน" ·
 * "a b c d จบ flow webhook ทั้งหมด ณ ตอนนี้ · อนาคต c อาจจะไม่จบ flow ก็ได้" ·
 * "ถ้าเลือก A ก็ต้องรู้เลยว่าจบไม่จบ".
 *
 * Two properties carry this design, and both are easy to lose by accident:
 *   · the scenarios are independent — none may import another;
 *   · whether the flow ends is DECLARED, so it is known the moment one is chosen
 *     rather than after work the caller never waits for.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACTIVE_REGISTER_SCENARIO,
  REGISTER_SCENARIOS,
  SCENARIO_A_CATEGORY,
  SCENARIO_A_NEED_DETAIL,
  handoffToRegister,
  resolveScenario,
  scenarioADividerText,
} from '@/modules/webhook/register';

const DIR = 'src/modules/webhook/register/scenarios';
const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');
/**
 * [FEAT-20260820-RESOLVEINFO] A real customer message, carrying BOTH numbers.
 *
 * ⚠️ It used to be `'เบอร์ 0812345678'` — one number, which was fine while A ended
 * the flow whatever it was handed. A now answers from what its resolver read, so
 * one number means found=false and the flow stays OPEN. The fixture carries a
 * pair because most cases below are about what A does once it HAS what it needs.
 * fixture ต้องมีครบคู่ ไม่งั้น A ไม่จบ flow ตามกฎใหม่.
 */
const HANDOFF = {
  hookId: 'h1',
  lineUserId: 'Uabc',
  messages: `1571226037 กสิกร
0915550012`,
  roomId: 'r1',
  scenario: 'A',
};

/** The same customer, but they have only said hello so far. */
const NOT_YET = { ...HANDOFF, messages: 'สวัสดีครับ' };

describe('the registry', () => {
  it('holds the letters the owner asked for, and A is the one selected today', () => {
    expect(Object.keys(REGISTER_SCENARIOS).sort()).toEqual(['A', 'B', 'C']);
    expect(ACTIVE_REGISTER_SCENARIO).toBe('A');
  });

  it('every scenario declares its own name, purpose and whether it ends the flow', () => {
    for (const [letter, s] of Object.entries(REGISTER_SCENARIOS)) {
      expect(s.name).toBe(letter);
      expect(typeof s.what).toBe('string');
      expect(s.what.length).toBeGreaterThan(0);
      /* [FEAT-20260820-RESOLVEINFO] was `toBe('boolean')`. A scenario may now
         COMPUTE this from what its resolver read — the owner's rule for A:
         "ถ้าเจอ true = endflow webhook · ถ้าเจอ false ไม่ end flow web hook". Both
         forms are legal; what must never change is that the answer is available
         without awaiting anything. ประกาศไว้ หรือคิดจากผลก็ได้ แต่ต้องตอบทันที. */
      expect(['boolean', 'function']).toContain(typeof s.endsFlow);
      expect(typeof s.run).toBe('function');
    }
  });

  it('the ones that always end the flow still say so plainly', () => {
    /* [FEAT-20260820-RESOLVEINFO] was "ALL of them end the flow today". That
       stopped being true the moment A began deciding from what it read — kept as
       a narrower claim rather than deleted, because B and C really are still
       unconditional and a change to either should be noticed here.
       A ไม่เข้าข่ายนี้แล้ว · B กับ C ยังใช่ ถ้าเปลี่ยนต้องรู้ตัว. */
    for (const letter of ['B', 'C']) {
      expect(REGISTER_SCENARIOS[letter]!.endsFlow).toBe(true);
    }
  });

  it('⭐ [FEAT-20260820-AALWAYSENDS] A ends the flow unconditionally now', () => {
    /* this assertion used to be `typeof ... === 'function'` — A decided from
       what it read. Owner, 2026-08-20: "ไม่นับตัวเลขแล้ว · endflow = true ทันที
       ไม่มี false แล้ว". A joins B and C as a flat `true`.
       The reader is still declared: it fills the log, it no longer decides. */
    expect(REGISTER_SCENARIOS['A']!.endsFlow).toBe(true);
    expect(REGISTER_SCENARIOS['A']!.resolver).toBe('basic');
  });

  it('resolves by letter, case-insensitively, and returns null for anything else', () => {
    expect(resolveScenario('a')?.name).toBe('A');
    expect(resolveScenario(' B ')?.name).toBe('B');
    expect(resolveScenario('D')).toBeNull();
    expect(resolveScenario('')).toBeNull();
    expect(resolveScenario(null)).toBeNull();
  });
});

describe('choosing one', () => {
  it('the CALLER picks, and the answer about the flow comes back immediately', () => {
    const log = jest.fn();
    expect(handoffToRegister(HANDOFF, { log })).toEqual({
      accepted: true,
      endFlow: true,
    });
  });

  it('⭐ a scenario that says it does NOT end the flow is obeyed', async () => {
    /* Today every scenario ends the flow, so nothing else in this suite can tell
       whether the declaration is read or the answer is simply hardcoded — a
       mutation proved exactly that. This is the mechanism the owner expects C to
       use one day ("c อาจจะไม่จบ flow ก็ได้"), so it is exercised now with a
       temporary scenario rather than left untested until it matters.
       พิสูจน์กลไกไว้ก่อน ไม่ใช่รอวันที่ต้องใช้จริง. */
    const log = jest.fn();
    const ran = jest.fn();
    (REGISTER_SCENARIOS as Record<string, unknown>)['Y'] = {
      name: 'Y',
      what: 'carries on',
      endsFlow: false,
      run: ran,
    };
    try {
      expect(handoffToRegister({ ...HANDOFF, scenario: 'Y' }, { log })).toEqual(
        {
          accepted: true,
          endFlow: false,
        },
      );
      await new Promise((r) => setImmediate(r));
      // and it still ran — "carry on" is about the caller, not about doing nothing
      expect(ran).toHaveBeenCalledTimes(1);
    } finally {
      delete (REGISTER_SCENARIOS as Record<string, unknown>)['Y'];
    }
  });

  it('an unknown letter runs nothing and leaves the flow alone', () => {
    /* the safe direction on a live conversation: a typo must not silently end
       somebody's chat. ไม่รู้จัก = ไม่ทำอะไร และไม่ตัด flow. */
    const log = jest.fn();
    expect(handoffToRegister({ ...HANDOFF, scenario: 'Z' }, { log })).toEqual({
      accepted: false,
      endFlow: false,
    });
  });

  it('a scenario that throws cannot reach the caller', async () => {
    const log = jest.fn();
    const boom = {
      name: 'X',
      what: 'throws',
      endsFlow: true,
      run: () => Promise.reject(new Error('boom')),
    };
    (REGISTER_SCENARIOS as Record<string, unknown>)['X'] = boom;
    try {
      expect(handoffToRegister({ ...HANDOFF, scenario: 'X' }, { log })).toEqual(
        {
          accepted: true,
          endFlow: true,
        },
      );
      await new Promise((r) => setImmediate(r));
      expect(log.mock.calls.some((c) => String(c[0]).includes('failed'))).toBe(
        true,
      );
    } finally {
      delete (REGISTER_SCENARIOS as Record<string, unknown>)['X'];
    }
  });

  it('B does nothing when no model was handed in', async () => {
    const log = jest.fn();
    handoffToRegister({ ...HANDOFF, scenario: 'B' }, { log });
    await new Promise((r) => setImmediate(r));
    expect(
      log.mock.calls.some((c) => String(c[0]).includes('SCENARIO-B')),
    ).toBe(false);
  });

  it('⭐ B asks about the WHOLE history, not just the first message', async () => {
    /* [FEAT-20260820-MSGSHAPE] a mutation that sliced the list to `[0]` survived
       every other test in this file: nothing looked at what B actually sent. The
       point of the door taking history is that history REACHES the model, so
       that is what is asserted — the last line matters as much as the first,
       because a customer types their account number after their greeting.
       ต้องถึงโมเดลครบทุกข้อความ ไม่ใช่แค่ข้อความแรก. */
    const log = jest.fn();
    const generate = jest
      .fn()
      .mockResolvedValue({ text: '{"phone_number":null,"account_no":null}' });
    handoffToRegister(
      {
        ...HANDOFF,
        scenario: 'B',
        messages: ['สวัสดีครับ', 'ขอถามหน่อย', 'บัญชี 1234567890'],
      },
      { log, generate },
    );
    await new Promise((r) => setImmediate(r));
    const asked = String(generate.mock.calls[0][0].question);
    expect(asked).toContain('สวัสดีครับ');
    expect(asked).toContain('ขอถามหน่อย');
    expect(asked).toContain('บัญชี 1234567890');
    /* ⚠️ ORDER IS LOAD-BEARING, not cosmetic: the prompt tells the model
       "ถ้ามีหลายค่า ให้เลือกค่าที่ลูกค้าระบุล่าสุด". Reverse the history and
       "latest" silently becomes "oldest" — the model then answers with a number
       the customer already corrected. A mutation that reversed the list survived
       until this assertion existed. ลำดับสลับ = โมเดลหยิบค่าที่ลูกค้าแก้ไปแล้ว. */
    expect(asked.indexOf('สวัสดีครับ')).toBeLessThan(
      asked.indexOf('ขอถามหน่อย'),
    );
    expect(asked.indexOf('ขอถามหน่อย')).toBeLessThan(
      asked.indexOf('บัญชี 1234567890'),
    );
  });

  it('B asks the model and reports only whether something was found', async () => {
    const log = jest.fn();
    const generate = jest.fn().mockResolvedValue({
      text: '{"phone_number":"0812345678","account_no":null}',
    });
    handoffToRegister({ ...HANDOFF, scenario: 'B' }, { log, generate });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const line = log.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('SCENARIO-B'));
    expect(line).toContain('phone=yes');
    expect(line).not.toContain('0812345678');
  });
});

describe('independence — one may be added or removed without touching the rest', () => {
  const files = readdirSync(join(process.cwd(), DIR)).filter((f) =>
    f.endsWith('.ts'),
  );

  it('no scenario imports another scenario', () => {
    for (const f of files) {
      if (f === 'index.ts') continue;
      const body = read(`${DIR}/${f}`)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const siblings = [...body.matchAll(/from\s+'(\.\/scenario-[a-z])'/g)].map(
        (m) => m[1],
      );
      expect({ file: f, siblings }).toEqual({ file: f, siblings: [] });
    }
  });

  it('the types file imports nothing at all', () => {
    const body = read(`${DIR}/scenario.types.ts`);
    expect([...body.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])).toEqual(
      [],
    );
  });

  it('nothing here reaches outside register/', () => {
    for (const f of files) {
      const body = read(`${DIR}/${f}`)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const outside = [...body.matchAll(/from\s+'([^']+)'/g)]
        .map((m) => m[1]!)
        .filter((i) => !i.startsWith('.'));
      expect({ file: f, outside }).toEqual({ file: f, outside: [] });
    }
  });

  it('the reserved one is genuinely empty — no hidden behaviour', () => {
    // A now opens a case; C is the one still reserved
    const body = read(`${DIR}/scenario-c.ts`)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(body).not.toContain('await');
    expect(body).not.toContain('deps.');
  });

  it('A hardcodes nothing — every word comes from its copy file', () => {
    const body = read(`${DIR}/scenario-a.ts`);
    expect(body).toContain("from './scenario-a.copy'");
    // the need text, the category and the divider sentence must not be inline
    expect(body.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain(
      'ต้องการลงทะเบียน',
    );
    expect(body).not.toContain("'Other'");
    expect(body).not.toContain('เคสนี้สร้างโดยระบบ');
  });
});

/**
 * [FEAT-20260820-FREEZE] A opened an unassigned case until 2026-08-20.
 * ===========================================================================
 * Owner: "end flow คือ webhook ไม่ทำงานอีกเลย เก็บแค่ chat message ของลูกค้าแล้วจบ แค่นั้น" ·
 * "found = true ยังไม่ทำอะไร แช่ไว้ freeze ไว้".
 *
 * The previous suite here asserted the case WAS opened (`cca24ee`). Those cases
 * are replaced rather than deleted, because the machinery is frozen, not removed
 * — `deps.openCase` is still handed in, `openTicketBySystem` still works, and
 * `scenario-a.copy.ts` still holds the words. What must stay true is that A does
 * not CALL any of it. เทสเดิมพิสูจน์ว่าเปิดเคส · ตอนนี้ต้องพิสูจน์ว่าไม่เรียกเลย.
 */
/**
 * [FEAT-20260820-UNFREEZE] A opens an unassigned case again — but only when found
 * ===========================================================================
 * Owner, in order on 2026-08-20: "found = true ยังไม่ทำอะไร แช่ไว้ freeze ไว้" →
 * "หมายถึง freeze ของเราอะ a ใส่ เลย ไม่ freeze แล้ว >> ว่า รับ needDetail +
 * dividerContent 'ต้องการลงทะเบียน' + ประเภท Other".
 *
 * The freeze lasted one round. What did NOT change across it is the condition:
 * the case is tied to `found`, because opening one claims the room and a claimed
 * room returns above the follow-up gate — so a case opened on `found = false`
 * would silence the bot from the next message on.
 */
describe('scenario A — opens an unassigned case once it has both numbers', () => {
  const opened = { ticketId: 't1', roomId: 'r1' };

  it('⭐ found → the flow ends AND a case is opened, with the words from the copy file', async () => {
    const log = jest.fn();
    const openCase = jest.fn().mockResolvedValue(opened);
    expect(handoffToRegister(HANDOFF, { log, openCase })).toEqual({
      accepted: true,
      endFlow: true,
    });
    await new Promise((r) => setImmediate(r));
    expect(openCase).toHaveBeenCalledWith({
      roomId: 'r1',
      category: SCENARIO_A_CATEGORY,
      needDetail: SCENARIO_A_NEED_DETAIL,
      dividerContent: scenarioADividerText(SCENARIO_A_NEED_DETAIL),
    });
  });

  it('⭐ [FEAT-20260820-AALWAYSENDS] no numbers at all → the case STILL opens and the flow STILL ends', async () => {
    /* THIS ASSERTION WAS INVERTED ON 2026-08-20. It used to read:
           expect(...).toEqual({ accepted: true, endFlow: false });
           expect(openCase).not.toHaveBeenCalled();
       and its reason was: opening a case claims the room, and a claimed room
       returns above the follow-up gate, so a case opened on a flow that carries
       on would silence the bot from the next message.
       That reason died with the rule — the flow now always ends, so the room
       being claimed is exactly right. Restore both lines together with the
       `endsFlow` line in `scenario-a.ts` if this is ever reverted.
       ไม่มีตัวเลขเลยก็เปิดเคส เพราะ flow จบทุกกรณีแล้ว. */
    const log = jest.fn();
    const openCase = jest.fn().mockResolvedValue(opened);
    expect(handoffToRegister(NOT_YET, { log, openCase })).toEqual({
      accepted: true,
      endFlow: true,
    });
    await new Promise((r) => setImmediate(r));
    expect(openCase).toHaveBeenCalledWith({
      roomId: NOT_YET.roomId,
      category: SCENARIO_A_CATEGORY,
      needDetail: SCENARIO_A_NEED_DETAIL,
      dividerContent: `เคสนี้สร้างโดยระบบ ${SCENARIO_A_NEED_DETAIL}`,
    });
  });

  it('⭐ the exact words the owner asked for', () => {
    /* pinned literally, because these are the strings an admin reads on the
       case and on the chat divider. ข้อความที่แอดมินเห็นจริง ตรึงไว้ตรงตัว. */
    expect(SCENARIO_A_NEED_DETAIL).toBe('ต้องการลงทะเบียน');
    expect(SCENARIO_A_CATEGORY).toBe('Other');
    expect(scenarioADividerText(SCENARIO_A_NEED_DETAIL)).toBe(
      'เคสนี้สร้างโดยระบบ ต้องการลงทะเบียน',
    );
  });

  it('⚠️ the category is spelled the way the collection holds it', () => {
    /* `ticket.schema.ts:95-107` says `category` has NO enum — Mongoose stores
       whatever it is handed, so a misspelling does not throw. The case just
       lands in a bucket no admin screen filters on and nobody finds out.
       ไม่มี enum ⇒ สะกดผิดไม่ error แต่เคสหายเงียบ ๆ. */
    expect(['Other', 'Payment']).toContain(SCENARIO_A_CATEGORY);
  });

  it('the divider is DERIVED from the need, so the two cannot drift apart', () => {
    expect(scenarioADividerText(SCENARIO_A_NEED_DETAIL)).toContain(
      SCENARIO_A_NEED_DETAIL,
    );
  });

  it('no case opener handed in → does nothing, and does not fail', async () => {
    const log = jest.fn();
    expect(handoffToRegister(HANDOFF, { log })).toEqual({
      accepted: true,
      endFlow: true,
    });
    await new Promise((r) => setImmediate(r));
    expect(
      log.mock.calls.some((c) => String(c[0]).includes('case opened')),
    ).toBe(false);
  });

  it('a room already in a case is an ordinary outcome, not an error', async () => {
    /* `openTicketBySystem` rejects with "ลูกค้ารายนี้มีเคสเปิดอยู่แล้ว" — which is
       also the duplicate guard, and must never surface on a live conversation. */
    const log = jest.fn();
    const openCase = jest
      .fn()
      .mockRejectedValue(new Error('ลูกค้ารายนี้มีเคสเปิดอยู่แล้ว'));
    expect(handoffToRegister(HANDOFF, { log, openCase })).toEqual({
      accepted: true,
      endFlow: true,
    });
    await new Promise((r) => setImmediate(r));
    expect(
      log.mock.calls.some((c) => String(c[0]).includes('no case opened')),
    ).toBe(true);
  });

  it('no room id → does not try to open anything', async () => {
    const log = jest.fn();
    const openCase = jest.fn();
    handoffToRegister({ ...HANDOFF, roomId: '' }, { log, openCase });
    await new Promise((r) => setImmediate(r));
    expect(openCase).not.toHaveBeenCalled();
  });

  it('it reports the case without the numbers', async () => {
    const log = jest.fn();
    const openCase = jest.fn().mockResolvedValue(opened);
    handoffToRegister(HANDOFF, { log, openCase });
    await new Promise((r) => setImmediate(r));
    const line = String(
      log.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('SCENARIO-A')),
    );
    expect(line).toContain('case opened');
    expect(line).not.toContain('0915550012');
    expect(line).not.toContain('1571226037');
  });
});

/**
 * [FEAT-20260820-RESOLVEINFO] the owner's rule, end to end
 * ===========================================================================
 * "ถ้าเจอ true = endflow webhook · ถ้าเจอ false ไม่ end flow web hook" ·
 * "end flow คือ webhook ไม่ทำงานอีกเลย เก็บแค่ chat message ของลูกค้าแล้วจบ แค่นั้น".
 */
describe('⭐ scenario A decides the flow from what it read', () => {
  it('⭐ one number is enough now — the rule was narrowed on purpose', () => {
    /* [FEAT-20260820-BASICBLUNT] this case used to assert the OPPOSITE: a phone
       with no account did not end the flow, because `basic register` insisted on
       both. The owner replaced that rule on 2026-08-20 with "a run of more than
       five digits anywhere", so a customer who sends only their account number —
       or only their phone — has replied, and the flow ends.
       The careful both-of-them rule is not gone: it moved whole to
       `dynamic-register.ts` and is still proved by `resolve-info-dynamic.spec.ts`.
       กฎเดิมย้ายไป dynamic · อันนี้คือกฎใหม่ที่เจ้าของสั่ง. */
    const log = jest.fn();
    expect(
      handoffToRegister({ ...HANDOFF, messages: 'เบอร์ 0915550012' }, { log })
        .endFlow,
    ).toBe(true);
  });

  it('⭐ [FEAT-20260820-AALWAYSENDS] ordinary chat ends the flow too — anything the customer sends counts as the reply', () => {
    /* this block asserted `.toBe(false)` until 2026-08-20. Nothing about the
       message matters any more: reaching level 2 at all is the answer.
       ⚠️ `basic` itself did NOT change — it still reports found=false for these
       three, and `resolve-info-basic.spec.ts` still proves it. What changed is
       that A stopped listening. ตัวอ่านเหมือนเดิม · คนฟังเลิกฟัง. */
    const log = jest.fn();
    for (const text of ['สวัสดีครับ', 'โอนแล้ว 500 บาท', 'ขอ 2 รายการ']) {
      expect(
        handoffToRegister({ ...HANDOFF, messages: text }, { log }).endFlow,
      ).toBe(true);
    }
  });

  it('⭐ an empty message, and a message the reader chokes on, end the flow as well', () => {
    /* the old rule treated "could not read" as "not found" and let the bot carry
       on. There is no such escape hatch left — deliberately.
       อ่านไม่ออกก็จบ ไม่มีทางหลุดกลับไปให้บอทคุยต่อแล้ว. */
    const log = jest.fn();
    for (const messages of ['', [], ['   '], [null as never]]) {
      expect(handoffToRegister({ ...HANDOFF, messages }, { log }).endFlow).toBe(
        true,
      );
    }
  });

  it('history works the same as one message — the pair may arrive split', () => {
    const log = jest.fn();
    expect(
      handoffToRegister(
        { ...HANDOFF, messages: ['1571226037 กสิกร', '0915550012'] },
        { log },
      ).endFlow,
    ).toBe(true);
  });

  it('and the hand-off reports what it decided, without the numbers', () => {
    const log = jest.fn();
    handoffToRegister(HANDOFF, { log });
    const line = String(
      log.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('[REGISTER-HANDOFF]')),
    );
    expect(line).toContain('resolved=true');
    expect(line).toContain('endFlow=true');
    expect(line).not.toContain('0915550012');
    expect(line).not.toContain('1571226037');
  });

  it('a scenario with no resolver is unaffected — B and C still answer plainly', () => {
    const log = jest.fn();
    for (const letter of ['B', 'C']) {
      expect(
        handoffToRegister({ ...NOT_YET, scenario: letter }, { log }).endFlow,
      ).toBe(true);
    }
  });

  it('⭐ the verdict does not wait on the scenario', () => {
    /* THE invariant the whole design rests on: the customer is never kept waiting.
       A first draft asserted a dep had not been CALLED yet — wrong, because
       `void (async () => …)()` runs its body synchronously up to the first
       `await`. What is never waited on is the RESULT.
       สิ่งที่ไม่รอคือ "ผล" ไม่ใช่ "การเรียก". */
    const log = jest.fn();
    const forever = jest.fn().mockReturnValue(new Promise(() => undefined));
    expect(handoffToRegister(HANDOFF, { log, openCase: forever })).toEqual({
      accepted: true,
      endFlow: true,
    });
  });
});

describe('the webhook is the one that chooses', () => {
  /* [PROG-20260905-SPINESRC] The follow-up gate's BODY moved to
   follow-up/follow-up-flow.ts at SP23; its binding stayed in the spine. Every rule below
   is about the gate's behaviour and holds wherever the body lives, so the source read here
   is the spine plus that role directory. Narrow list, not the whole module: a smaller list
   is a stronger assertion. */
  const wh =
    read('src/modules/webhook/webhook.service.ts') +
    read('src/modules/webhook/gates/follow-up-flow.ts');

  it('it passes the active letter at the moment level 2 fires', () => {
    expect(wh).toContain('scenario: ACTIVE_REGISTER_SCENARIO,');
    expect(wh).toContain('if (followUp.handOffToRegister) {');
  });

  it('and it stops only because the scenario said to', () => {
    /* not an unconditional stop: the day a scenario should let the bot carry on,
       this line already honours it.
       ⚠️ [FEAT-20260820-STICKERFOLLOWUP] the literal gained ` true` when the block
       became a closure that answers "is the flow over" to its two call sites —
       the silent-type gate needs the same flow, and a bare `return` there would
       have meant "end the whole event" for a case it must not decide.
       เดิมเป็น `return;` · เป็น closure แล้วต้องตอบค่ากลับ. */
    expect(wh).toContain('if (handed.endFlow) return true;');
  });
});
