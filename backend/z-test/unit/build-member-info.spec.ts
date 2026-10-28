/**
 * [FEAT-20260820-MEMBERINFO] pull a phone and an account out of what was written
 * ===========================================================================
 * Owner: "ทำ function ชื่อ buildMemberInfo ส่ง msg ของลูกค้าไป (อนาคต msg อาจจะเปลี่ยน
 * เป็น set ข้อความ history ก็ได้ ต้องรองรับ) > prompt บอก ai ว่าให้ค้นหาเบอร์โทรและ
 * เลขที่บัญชี และตอบกลับเป็น json · prompt นี้แก้ไขได้ · พอได้คำตอบแล้วกลับมาที่
 * register helper ยังไม่ทำอะไรต่อ" · "ลูกค้าไม่ต้องรอ".
 *
 * A model is the least predictable dependency in this codebase, so what is
 * pinned here is everything that must hold WHATEVER it answers: prose around the
 * JSON, a refusal, a timeout, a wrong type, a fabricated "null" string. None of
 * them may throw, and none may invent a value.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUILD_MEMBER_INFO_PROMPT,
  MEMBER_INFO_FIELDS,
  buildMemberInfo,
  handoffToRegister,
} from '@/modules/webhook/register';

const src = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');
const answering = (text: unknown) => ({
  generate: jest.fn().mockResolvedValue({ text }),
  warn: jest.fn(),
});
const ONE = { messages: ['เบอร์ 0812345678 บัญชี 1234567890'] };

describe('what it asks for', () => {
  it('sends the customer’s words as the question, and the instruction as training text', async () => {
    const deps = answering('{"phone_number":null,"account_no":null}');
    await buildMemberInfo(ONE, deps);
    const req = deps.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(req['question']).toBe(ONE.messages[0]);
    expect(req['suggestionText']).toBe(BUILD_MEMBER_INFO_PROMPT);
    expect(req['profileData']).toBeNull();
  });

  it('accepts a LIST from day one — history later costs the caller nothing', async () => {
    const deps = answering('{"phone_number":"0812345678","account_no":null}');
    await buildMemberInfo(
      { messages: ['ชื่อ สมชาย', 'เบอร์ 0812345678'] },
      deps,
    );
    const req = deps.generate.mock.calls[0][0] as Record<string, unknown>;
    expect(req['question']).toBe('ชื่อ สมชาย\nเบอร์ 0812345678');
  });

  it('the prompt asks for both fields, as JSON, and forbids guessing', () => {
    expect(MEMBER_INFO_FIELDS).toEqual(['phone_number', 'account_no']);
    for (const must of ['phone_number', 'account_no', 'JSON', 'ห้ามเดา']) {
      expect(BUILD_MEMBER_INFO_PROMPT).toContain(must);
    }
  });
});

describe('what it does with the answer', () => {
  it('reads a clean JSON answer', async () => {
    const deps = answering(
      '{"phone_number":"0812345678","account_no":"1234567890"}',
    );
    expect(await buildMemberInfo(ONE, deps)).toEqual({
      found: true,
      phoneNumber: '0812345678',
      accountNo: '1234567890',
    });
  });

  it('digs the JSON out of prose or a code fence', async () => {
    const deps = answering(
      'ได้ข้อมูลแล้วค่ะ ```json\n{"phone_number":"0899999999","account_no":null}\n``` ขอบคุณค่ะ',
    );
    expect(await buildMemberInfo(ONE, deps)).toEqual({
      found: true,
      phoneNumber: '0899999999',
      accountNo: null,
    });
  });

  it('one field found is still a find', async () => {
    const deps = answering('{"phone_number":null,"account_no":"1112223334"}');
    const r = await buildMemberInfo(ONE, deps);
    expect(r.found).toBe(true);
    expect(r.phoneNumber).toBeNull();
  });

  it('nothing found is NOT a find — and never a guess', async () => {
    const deps = answering('{"phone_number":null,"account_no":null}');
    expect(await buildMemberInfo(ONE, deps)).toEqual({
      found: false,
      phoneNumber: null,
      accountNo: null,
    });
  });

  it('the STRING "null" is treated as nothing — models write it', async () => {
    const deps = answering('{"phone_number":"null","account_no":"NULL"}');
    expect((await buildMemberInfo(ONE, deps)).found).toBe(false);
  });

  it('a number is accepted and stringified — models drop the quotes', async () => {
    const deps = answering('{"phone_number":812345678,"account_no":null}');
    expect((await buildMemberInfo(ONE, deps)).phoneNumber).toBe('812345678');
  });

  it('a value of the wrong type is ignored, not coerced', async () => {
    const deps = answering('{"phone_number":{"a":1},"account_no":["x"]}');
    expect((await buildMemberInfo(ONE, deps)).found).toBe(false);
  });

  it.each([
    ['prose with no JSON', 'ขอโทษค่ะ ไม่พบข้อมูล'],
    ['broken JSON', '{"phone_number": '],
    ['empty', ''],
    ['null text', null],
  ])('%s → nothing found, and no throw', async (_l, text) => {
    const deps = answering(text);
    await expect(buildMemberInfo(ONE, deps)).resolves.toEqual({
      found: false,
      phoneNumber: null,
      accountNo: null,
    });
  });
});

describe('what it refuses to do', () => {
  it('no messages → does not call the model at all', async () => {
    const deps = answering('{}');
    expect((await buildMemberInfo({ messages: [] }, deps)).found).toBe(false);
    expect((await buildMemberInfo({ messages: ['  '] }, deps)).found).toBe(
      false,
    );
    expect(deps.generate).not.toHaveBeenCalled();
  });

  it('no model handed in → returns nothing instead of failing', async () => {
    const r = await buildMemberInfo(ONE, {
      generate: undefined as never,
      warn: jest.fn(),
    });
    expect(r.found).toBe(false);
  });

  it('a model that throws is swallowed and reported once', async () => {
    const warn = jest.fn();
    const deps = {
      generate: jest.fn().mockRejectedValue(new Error('timeout')),
      warn,
    };
    await expect(buildMemberInfo(ONE, deps)).resolves.toEqual({
      found: false,
      phoneNumber: null,
      accountNo: null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the customer never waits', () => {
  const helper = src('src/modules/webhook/register/register.helper.ts');
  const scenarioB = src('src/modules/webhook/register/scenarios/scenario-b.ts');

  it('the hand-off runs the scenario without waiting, and stays synchronous', () => {
    expect(helper).toContain('void (async () => {');
    // synchronous on purpose — the webhook cannot accidentally await it
    expect(helper).toContain('export function handoffToRegister(');
    expect(helper).not.toContain('export async function handoffToRegister(');
  });

  it('without a model the hand-off still accepts the message', () => {
    const log = jest.fn();
    expect(
      handoffToRegister(
        {
          hookId: 'h1',
          lineUserId: 'U1',
          messages: 'x',
          roomId: 'r1',
          scenario: 'A',
        },
        { log },
      ).accepted,
    ).toBe(true);
    /* [FEAT-20260820-RESOLVEINFO] this used to assert `endFlow: true` as well.
       It is not what this case is about — "accepts the message" is — and A now
       answers `endFlow` from what its resolver read, so `'x'` (no numbers at all)
       correctly leaves the flow open. The flow rule has its own cases in
       `register-scenarios.spec.ts`. เทสนี้วัด accepted · endFlow ไปวัดที่อื่น. */
  });

  it('nothing is done with the result yet — only a log without the values', () => {
    /* owner: "ยังไม่ทำอะไรต่อ". The log records WHETHER something was found, never
       the phone or the account itself. It lives in scenario B now. */
    expect(scenarioB).toContain("phone=${info.phoneNumber ? 'yes' : 'no'}");
    expect(scenarioB).not.toContain('${info.phoneNumber}');
  });
});
