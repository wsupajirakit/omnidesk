/**
 * [FEAT-20260820-BASICBLUNT] `basic register` — is there a number at all?
 * ===========================================================================
 * Owner, 2026-08-20: "basic ปัจจุบันปรับ ให้เป็น เจอตัวเลข มากกว่า 5 ตัว (ตัดขีด ตัด trim
 * แล้ว) ตรงไหนก็ได้ไม่สน ทำ flow เดิมเลย endFlow = true · ถ้าไม่เจอ endFlow = false".
 *
 * ONE QUESTION: a run of MORE THAN FIVE digits, anywhere. Nothing about which
 * number is a phone and which is an account — the careful rule that judged that
 * moved to `dynamic-register.ts` and is covered by `resolve-info-dynamic.spec.ts`.
 * ที่นี่ถามข้อเดียว · ของที่ตัดสินว่าเลขไหนเป็นอะไร ย้ายไป dynamic แล้ว.
 */
import {
  BASIC_REGISTER,
  MIN_DIGITS,
  digitRuns,
} from '@/modules/webhook/resolve-info';

const basic = (...messages: string[]) => BASIC_REGISTER.resolve({ messages });

describe('⭐ more than five digits, anywhere', () => {
  it('the threshold is six — five is not enough', () => {
    expect(MIN_DIGITS).toBe(6);
    expect(basic('12345').found).toBe(false);
    expect(basic('123456').found).toBe(true);
  });

  it('it does not care what the number is or where it sits', () => {
    for (const text of [
      '0915550012',
      '1571226037',
      'เลขบัญชี 1571226037 นะครับ',
      'ครับผม 0915550012',
      'aaa123456bbb',
    ]) {
      expect({ text, found: basic(text).found }).toEqual({ text, found: true });
    }
  });

  it('a run broken by dashes counts as one number', () => {
    /* `235-8-87879-5` is one account — a real customer wrote it that way. Without
       joining across dashes the longest run here is five digits and this misses.
       ขีดคั่นต้องรวมเป็นก้อนเดียว ไม่งั้นตกเกณฑ์. */
    expect(basic('235-8-87879-5').found).toBe(true);
    expect(digitRuns(['235-8-87879-5'])).toEqual(['2358878795']);
  });

  it('⭐ two short numbers side by side do NOT add up to one long one', () => {
    /* `123 456` is two threes, not a six. If whitespace joined runs, ordinary
       chat would look like an account number. เว้นวรรคต้องไม่เชื่อมเลข. */
    expect(basic('123 456').found).toBe(false);
    expect(basic('12345 12345').found).toBe(false);
  });

  it('short numbers in ordinary chat stay silent', () => {
    for (const text of [
      'สวัสดีครับ',
      'โอนแล้ว 500 บาท',
      'ขอ 2 รายการ',
      'วันที่ 20 เดือน 8 ปี 2026',
      '',
    ]) {
      expect({ text, found: basic(text).found }).toEqual({
        text,
        found: false,
      });
    }
  });
});

describe('history and one message read the same', () => {
  it('a long run in ANY message counts', () => {
    expect(basic('สวัสดี', 'ครับ', '0915550012').found).toBe(true);
  });

  it('short runs spread across messages never combine', () => {
    expect(basic('123', '456').found).toBe(false);
  });

  it('no messages at all is not found', () => {
    expect(BASIC_REGISTER.resolve({ messages: [] }).found).toBe(false);
  });
});

describe('the answer keeps the shape every resolver returns', () => {
  it('always two candidates, found or not', () => {
    for (const text of ['0915550012', 'สวัสดี']) {
      expect(basic(text).candidates).toHaveLength(2);
    }
    expect(basic('สวัสดี').candidates).toEqual([
      { phone: null, account: null },
      { phone: null, account: null },
    ]);
  });

  it('it reports itself as `basic`', () => {
    expect(basic('0915550012').by).toBe('basic');
    expect(basic('สวัสดี').by).toBe('basic');
  });

  it('⚠️ the slots are the runs in order — NOT a judgement', () => {
    /* This rule does not decide which number is a phone. The fields are filled so
       the shape holds; reading meaning into them is what `dynamic` is for.
       ช่องนี้ไม่ได้แปลว่าเป็นเบอร์ · แค่เรียงตามที่เขียนมา. */
    const out = basic('1571226037 กสิกร\n0915550012');
    expect(out.candidates[0]).toEqual({
      phone: '1571226037',
      account: '0915550012',
    });
    expect(out.candidates[1]).toEqual({
      phone: '0915550012',
      account: '1571226037',
    });
  });

  it('one long run alone still answers found, with an empty second slot', () => {
    expect(basic('0915550012').candidates[0]).toEqual({
      phone: '0915550012',
      account: null,
    });
  });
});

describe('the careful rule was parked, not deleted', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const read = (rel: string) =>
    fs.readFileSync(`${process.cwd()}/${rel}`, 'utf8');

  it('⭐ dynamic-register.ts still holds the leading-zero rule', () => {
    /* the knowledge in it was paid for with two real customer messages; if this
       goes red the parked rule was quietly gutted. ของที่จอดไว้ต้องยังครบ. */
    const dyn = read('src/modules/webhook/resolve-info/dynamic-register.ts');
    expect(dyn).toContain("PHONE_PREFIX = '0'");
    expect(dyn).toContain('PHONE_RULES');
    expect(dyn).toContain('run !== phone'); // the duplicate-removal fix
  });

  it('it is registered so it stays compiled — and selected by nobody', () => {
    const idx = read('src/modules/webhook/resolve-info/index.ts');
    expect(idx).toContain('dynamic: DYNAMIC_REGISTER');
    const scenarioA = read(
      'src/modules/webhook/register/scenarios/scenario-a.ts',
    );
    expect(scenarioA).toContain("resolver: 'basic'");
    expect(scenarioA).not.toContain("resolver: 'dynamic'");
  });
});
