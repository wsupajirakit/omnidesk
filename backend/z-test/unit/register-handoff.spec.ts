/**
 * [FEAT-20260820-REGISTERHANDOFF] level 3's destination — deliberately empty
 * ===========================================================================
 * Owner: "ส่งข้อความที่ลูกค้าส่งมา + hook id + line user id ไปยัง function ใหม่ ...
 * แล้วส่งไป ยังไม่ทำอะไร".
 *
 * There is nothing to test about behaviour yet, so what is tested is the CONTRACT
 * and the neutrality: the three values it takes, that it refuses a call it cannot
 * attribute, and that it stays free of the webhook so it can be called from
 * anywhere — or deleted without touching anything else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REGISTER_SCENARIOS,
  type RegisterHandoffInput,
  handoffToRegister,
} from '@/modules/webhook/register';

const src = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

describe('the hand-off contract', () => {
  it('accepts a message it can attribute, and says so', () => {
    const log = jest.fn();
    expect(
      handoffToRegister(
        {
          hookId: 'h1',
          lineUserId: 'Uabc',
          messages: 'สวัสดี',
          roomId: 'r1',
          scenario: 'A',
        },
        { log },
      ).accepted,
    ).toBe(true);
    /* The hand-off logs its own line. It is no longer the ONLY line: scenario A
       now reports what it resolved, and its "nothing usable yet" branch runs
       synchronously (before any await), so a bare call count would count both.
       Assert the hand-off's own line instead of how many there were.
       นับจำนวนบรรทัดไม่ได้แล้ว · ต้องดูบรรทัดของประตูเอง. */
    expect(
      log.mock.calls.filter((c) => String(c[0]).includes('[REGISTER-HANDOFF]')),
    ).toHaveLength(1);
  });

  it.each([
    [
      'no hook',
      {
        hookId: '',
        lineUserId: 'Uabc',
        messages: 'x',
        roomId: 'r1',
        scenario: 'A',
      },
    ],
    [
      'no customer',
      {
        hookId: 'h1',
        lineUserId: '',
        messages: 'x',
        roomId: 'r1',
        scenario: 'A',
      },
    ],
  ])('%s → refuses, and logs nothing', (_l, input) => {
    const log = jest.fn();
    expect(handoffToRegister(input as never, { log })).toEqual({
      accepted: false,
      endFlow: false,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('an empty message is still accepted — a customer may send a sticker', () => {
    const log = jest.fn();
    expect(
      handoffToRegister(
        {
          hookId: 'h1',
          lineUserId: 'Uabc',
          messages: '',
          roomId: 'r1',
          scenario: 'A',
        },
        { log },
      ).accepted,
    ).toBe(true);
  });

  it('it does NOT log the message body — the content stays in chat history only', () => {
    const log = jest.fn();
    handoffToRegister(
      {
        hookId: 'h1',
        lineUserId: 'Uabc',
        messages: 'เลขบัญชี 1234567890',
        roomId: 'r1',
        scenario: 'A',
      },
      { log },
    );
    expect(log.mock.calls[0][0]).not.toContain('1234567890');
  });
});

describe('neutrality — it must be removable and callable from anywhere', () => {
  /* Comments are stripped first: the header names `webhook.service` in its
     `revert:` line, which is documentation, not a dependency. A first attempt
     failed on exactly that. ตรวจโค้ด ไม่ใช่คอมเมนต์. */
  const file = src('src/modules/webhook/register/register.helper.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('knows nothing about Nest, LINE or the webhook', () => {
    for (const forbidden of [
      '@Injectable',
      '@nestjs',
      'lineApi',
      'LineEvent',
      'webhook.service',
      'mongoose',
    ]) {
      expect(file).not.toContain(forbidden);
    }
  });

  it('takes plain values and returns a verdict — it sends nothing itself', () => {
    expect(file).toContain('export function handoffToRegister(');
  });
});

/**
 * [FEAT-20260820-MSGSHAPE] the door takes one message OR a stretch of history
 * ===========================================================================
 * Owner: "ก้อน msg อะต้องรับทั้งการส่งแบบ msg ธรรมดา หรือ history ก็ได้" ·
 * "ต้องไม่พัง อิสระ ยืดหยุ่น".
 *
 * The flexibility is at the DOOR only. Inside, every scenario sees one shape —
 * `messages: string[]` — so a scenario written next year cannot forget to handle
 * the other one. That normalisation is the thing these tests pin: the union is
 * allowed to exist in exactly one place. ยืดหยุ่นที่ประตู · ข้างในเหลือแบบเดียว.
 */
describe('the message blob — one, or many', () => {
  /** Registers a throwaway scenario that captures what it was handed. */
  const capture = (
    letter: string,
    fn: (input: unknown) => void,
  ): (() => void) => {
    (REGISTER_SCENARIOS as Record<string, unknown>)[letter] = {
      name: letter,
      what: 'captures its input',
      endsFlow: true,
      run: (input: unknown) => fn(input),
    };
    return () => delete (REGISTER_SCENARIOS as Record<string, unknown>)[letter];
  };

  const handOff = async (messages: unknown): Promise<unknown> => {
    let seen: unknown;
    const undo = capture('Q', (i) => (seen = i));
    try {
      handoffToRegister(
        {
          hookId: 'h1',
          lineUserId: 'Uabc',
          messages,
          roomId: 'r1',
          scenario: 'Q',
        } as never,
        { log: jest.fn() },
      );
      await new Promise((r) => setImmediate(r));
      return seen;
    } finally {
      undo();
    }
  };

  it('⭐ a single message arrives at the scenario as a one-item list', async () => {
    /* the shape the webhook sends today. It must not have to know it is being
       normalised — that is the whole point of the union living at the door. */
    expect((await handOff('สวัสดี')) as { messages: string[] }).toMatchObject({
      messages: ['สวัสดี'],
    });
  });

  it('⭐ history arrives whole, in order, untouched', async () => {
    expect(
      (await handOff(['ก่อน', 'กลาง', 'หลัง'])) as { messages: string[] },
    ).toMatchObject({ messages: ['ก่อน', 'กลาง', 'หลัง'] });
  });

  it('⭐ a scenario NEVER sees the union — always an array, whatever came in', async () => {
    /* the property that makes writing scenario D safe: there is no second shape
       to remember. A mutation that passes the raw value through kills this. */
    for (const input of ['x', ['x'], '', [], ['a', 'b']]) {
      const seen = (await handOff(input)) as { messages: unknown };
      expect(Array.isArray(seen.messages)).toBe(true);
    }
  });

  it('empty — a string, a list, or nothing at all — is still accepted', () => {
    /* `accepted` answers "could this be attributed", which is hook + customer.
       It is deliberately NOT coupled to what was said: a sticker has no text and
       the customer is no less stuck. อิสระจากเนื้อความ. */
    for (const messages of ['', [], undefined, null]) {
      expect(
        handoffToRegister(
          {
            hookId: 'h1',
            lineUserId: 'Uabc',
            messages,
            roomId: 'r1',
            scenario: 'A',
          } as never,
          { log: jest.fn() },
        ).accepted,
      ).toBe(true);
    }
  });

  it('rubbish inside the list is dropped, not carried and not thrown on', async () => {
    /* history assembled by a caller may hold blanks or a non-string; a live
       conversation must not die on it. ขยะในลิสต์ = ทิ้ง ไม่ใช่พัง. */
    const seen = (await handOff(['ดี', '', '   ', null, 42, 'จบ'])) as {
      messages: string[];
    };
    expect(seen.messages).toEqual(['ดี', 'จบ']);
  });

  it('⭐ BOTH shapes are legal at the type level, with no cast', () => {
    /* The runtime tests above all cast, because several of them feed rubbish on
       purpose. This one does not: if `messages` ever narrows back to a single
       type, ONE of these two lines stops compiling and the suite goes red before
       anybody runs it. พิสูจน์ที่ type ด้วย ไม่ใช่แค่ตอนรัน. */
    const one: RegisterHandoffInput = {
      hookId: 'h1',
      lineUserId: 'Uabc',
      messages: 'ข้อความเดียว',
      roomId: 'r1',
      scenario: 'A',
    };
    const many: RegisterHandoffInput = { ...one, messages: ['ก่อน', 'หลัง'] };
    const log = jest.fn();
    for (const input of [one, many]) {
      expect(handoffToRegister(input, { log }).accepted).toBe(true);
    }
  });

  it('still logs how many, never what was said', () => {
    const log = jest.fn();
    handoffToRegister(
      {
        hookId: 'h1',
        lineUserId: 'Uabc',
        messages: ['เลขบัญชี 1234567890', 'เบอร์ 0812345678'],
        roomId: 'r1',
        scenario: 'A',
      },
      { log },
    );
    const line = String(log.mock.calls[0][0]);
    expect(line).not.toContain('1234567890');
    expect(line).not.toContain('0812345678');
    expect(line).toContain('msgs=2');
  });
});
