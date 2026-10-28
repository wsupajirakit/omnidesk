/**
 * [FEAT-20260820-DYNAMICPARK] `resolveInfo` → `dynamic register` (parked)
 * ===========================================================================
 * Owner: "ให้หาชุดตัวเลข ที่ติดกัน · 10 ตัว นั้นคือเบอร์โทร · ถ้าขึ้นต้นด้วย 0 assume ว่าคือเบอร์
 * ไว้ก่อน แล้วค่อย proirty อย่างอื่นทำเป็นเงื่อนไขแบบยืดหยุ่นไว้" · "เก็บตัวแปรที่สกัดได้
 * xxx phone // xxx account // found = true · และขอแบบ inverse ด้วยสลับกันไว้".
 *
 * ⚠️ THESE CASES MOVED WITH THE RULE. They tested `basic register` until
 * 2026-08-20, when the owner replaced the live rule with a blunt "more than five
 * digits anywhere" and the careful version moved to `dynamic-register.ts` whole.
 * The cases came with it unchanged — the rule they describe is still exactly the
 * rule that file implements, and it is registered and compiled even though
 * nothing selects it. Deleting them would throw away the only proof that the
 * parked rule still works the day somebody switches to it.
 * เทสย้ายตามกฎ · ของที่จอดไว้ต้องยังพิสูจน์ได้ว่าใช้งานได้จริง.
 *
 * ⚠️ THE TWO MESSAGES AT THE TOP ARE REAL — the owner pasted them from live
 * conversations. They are the reason this resolver cannot judge by length: in
 * BOTH of them the phone and the account are ten digits and the phone is last.
 * They are pinned verbatim so a future "improvement" that reads well but picks
 * the wrong number goes red here. ข้อความจริงจากลูกค้า ห้ามแก้ให้เข้ากับโค้ด.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DYNAMIC_REGISTER,
  INFO_RESOLVERS,
  getResolver,
  resolveInfo,
} from '@/modules/webhook/resolve-info';

/** Owner's message #1 — account first (starts with 1), phone last. */
const REAL_ONE = `อธิพัชร์  ธันยบูรณ์นนทกร
1571226037  กสิกร
0915550012`;

/** Owner's message #2 — account first AND written with dashes, phone last. */
const REAL_TWO = `ระกา รักษาน้อย
235-8-87879-5
กสิกร
0635550013`;

const basic = (...messages: string[]) => DYNAMIC_REGISTER.resolve({ messages });

describe('the two real customer messages', () => {
  it('⭐ #1 — the ten-digit run starting with 0 is the phone, not the other one', () => {
    /* the trap: `1571226037` is ALSO exactly ten digits and comes FIRST. A rule
       that took "first ten-digit run" would answer with the account here. */
    expect(basic(REAL_ONE)).toEqual({
      by: 'dynamic',
      found: true,
      candidates: [
        { phone: '0915550012', account: '1571226037' },
        { phone: '1571226037', account: '0915550012' },
      ],
    });
  });

  it('⭐ #2 — an account written with dashes is ONE number, not four', () => {
    /* `235-8-87879-5` → `2358878795`. Without joining across `-` this message
       yields the runs 235 / 8 / 87879 / 5 and the answer is nonsense. */
    expect(basic(REAL_TWO)).toEqual({
      by: 'dynamic',
      found: true,
      candidates: [
        { phone: '0635550013', account: '2358878795' },
        { phone: '2358878795', account: '0635550013' },
      ],
    });
  });

  it('⭐ length alone would get #1 wrong — proving the leading zero is doing the work', () => {
    /* Both runs are the same length, so any rule that does not look at the first
       character cannot tell them apart. This states that explicitly so nobody
       "simplifies" the rule back to a length check. */
    const runs = ['1571226037', '0915550012'];
    expect(runs[0]!.length).toBe(runs[1]!.length);
    expect(basic(REAL_ONE).candidates[0]!.phone).toBe('0915550012');
  });
});

describe('reading one message or a whole history', () => {
  it('the same numbers split across separate messages still resolve', () => {
    /* the point of the hand-off door taking history: a customer who sends their
       account and their phone as two messages is the same customer. */
    expect(basic('1571226037 กสิกร', '0915550012').candidates[0]).toEqual({
      phone: '0915550012',
      account: '1571226037',
    });
  });

  it('a message list is joined by newline, so numbers never merge across it', () => {
    /* two ten-digit runs in separate messages must stay two runs. If they were
       joined by a space this would become one twenty-digit number. */
    const out = basic('0915550012', '1571226037');
    expect(out.found).toBe(true);
    expect(out.candidates[0]!.phone).toBe('0915550012');
  });

  it('two numbers separated by a space on ONE line do not merge', () => {
    expect(basic('1571226037 0915550012').candidates[0]).toEqual({
      phone: '0915550012',
      account: '1571226037',
    });
  });
});

describe('when more than one run answers the same rule', () => {
  it('⭐ two runs both starting with 0 → the LAST one is the phone', () => {
    /* Neither real message has this, so nothing else in this file can tell
       whether "last wins" is implemented or whether first-vs-last simply never
       differed — a mutation to `hits[0]` survived until this case existed.
       Last is the evidenced choice: in both real messages the phone sits at the
       bottom, under the account. เจอหลายตัวที่เข้ากติกาเดียวกัน = เอาตัวท้าย. */
    expect(basic('0812345678', '0915550012').candidates[0]).toEqual({
      phone: '0915550012',
      account: '0812345678',
    });
  });

  it('and the same holds inside one multi-line message', () => {
    expect(basic('บช 0812345678\nเบอร์ 0915550012').candidates[0]!.phone).toBe(
      '0915550012',
    );
  });
});

describe('a customer who typed other numbers too', () => {
  it('⭐ an amount in the message is not mistaken for the account', () => {
    /* Real shape of a message that also mentions money. The runs here are
       `500`, the account and the phone; without preferring a run of a plausible
       ACCOUNT length the answer takes `500` — the first thing left over once the
       phone is claimed — and reports found=true on rubbish. A mutation that
       dropped that preference survived every other case in this file.
       ยอดเงินไม่ใช่เลขบัญชี · ต้องเลือกตัวที่ความยาวเข้าเค้า. */
    expect(basic('โอนแล้ว 500 บาท', '1571226037 กสิกร', '0915550012')).toEqual({
      by: 'dynamic',
      found: true,
      candidates: [
        { phone: '0915550012', account: '1571226037' },
        { phone: '1571226037', account: '0915550012' },
      ],
    });
  });
});

describe('the same number written twice', () => {
  it('⭐ one number can never fill BOTH slots', () => {
    /* Found by mutation, then reproduced against the real algorithm: a customer
       who types their phone twice used to get `phone === account`, with
       found=true — one number reported as two pieces of information, which is
       the worst possible answer because it looks complete.
       เลขเดียวห้ามไปโผล่ทั้งสองช่อง · ตอบ true ทั้งที่มีเลขเดียวคือแย่ที่สุด. */
    const out = basic('เบอร์ 0915550012', 'ย้ำนะ 0915550012');
    /* one number written twice is still ONE number, so the honest answer is
       "nothing found" — not the same digits reported in both slots. */
    expect(out).toEqual({
      by: 'dynamic',
      found: false,
      candidates: [
        { phone: null, account: null },
        { phone: null, account: null },
      ],
    });
  });

  it('but a duplicate alongside a real account still resolves', () => {
    const out = basic('0915550012', '1571226037', '0915550012');
    expect(out).toEqual({
      by: 'dynamic',
      found: true,
      candidates: [
        { phone: '0915550012', account: '1571226037' },
        { phone: '1571226037', account: '0915550012' },
      ],
    });
  });
});

describe('found — both, or it is false', () => {
  it.each([
    ['nothing at all', ['สวัสดีครับ']],
    ['only a phone', ['0915550012']],
    ['only an account', ['1571226037']],
    ['no messages', []],
  ])('%s → found=false and both candidates empty', (_label, messages) => {
    const out = DYNAMIC_REGISTER.resolve({ messages });
    expect(out.found).toBe(false);
    expect(out.candidates).toEqual([
      { phone: null, account: null },
      { phone: null, account: null },
    ]);
  });

  it('⚠️ it always answers with EXACTLY two candidates, found or not', () => {
    /* a consumer reading `candidates[1]` must never have to check whether it is
       there. ผู้เรียกไม่ต้องเช็คว่ามีช่องที่สองไหม. */
    for (const messages of [[REAL_ONE], ['สวัสดี'], []]) {
      expect(DYNAMIC_REGISTER.resolve({ messages }).candidates).toHaveLength(2);
    }
  });
});

describe('the inverse candidate', () => {
  it('⭐ [1] is [0] with the two values traded — nothing else differs', () => {
    const [best, swapped] = basic(REAL_ONE).candidates;
    expect(swapped).toEqual({ phone: best!.account, account: best!.phone });
  });

  it('the swap is what covers a wrong pick when nothing leads with a zero', () => {
    /* neither run starts with 0, so the resolver falls to its length rule and
       could well be wrong — which is exactly when [1] earns its place. */
    const out = basic('1571226037 และ 2358878795');
    expect(out.found).toBe(true);
    expect(out.candidates[1]).toEqual({
      phone: out.candidates[0]!.account,
      account: out.candidates[0]!.phone,
    });
  });
});

describe('the registry — anyone may call it, and an unknown name is not an error', () => {
  it('holds basic, and resolves by name case-insensitively', () => {
    expect(Object.keys(INFO_RESOLVERS)).toContain('dynamic');
    expect(getResolver('DYNAMIC')?.name).toBe('dynamic');
    expect(getResolver(' dynamic ')?.name).toBe('dynamic');
  });

  it('an unregistered name answers null rather than throwing', () => {
    /* the caller is mid-conversation with a customer; a typo must not become an
       exception on their turn. */
    expect(resolveInfo('nosuchresolver', { messages: [REAL_ONE] })).toBeNull();
    expect(resolveInfo('', { messages: [REAL_ONE] })).toBeNull();
    expect(resolveInfo(null, { messages: [REAL_ONE] })).toBeNull();
  });

  it('a resolver that throws is swallowed into null', () => {
    (INFO_RESOLVERS as Record<string, unknown>)['boom'] = {
      name: 'boom',
      what: 'throws',
      resolve: () => {
        throw new Error('boom');
      },
    };
    try {
      expect(resolveInfo('boom', { messages: ['x'] })).toBeNull();
    } finally {
      delete (INFO_RESOLVERS as Record<string, unknown>)['boom'];
    }
  });

  it('every registered resolver answers the same shape', () => {
    for (const [key, r] of Object.entries(INFO_RESOLVERS)) {
      expect(r.name).toBe(key);
      expect(typeof r.what).toBe('string');
      const out = r.resolve({ messages: [REAL_ONE] });
      expect(typeof out.found).toBe('boolean');
      expect(out.candidates).toHaveLength(2);
      expect(out.by).toBe(key);
    }
  });
});

describe('neutrality — it must be callable from anywhere and removable', () => {
  const read = (rel: string): string =>
    readFileSync(join(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  it.each(['index.ts', 'dynamic-register.ts', 'resolve-info.types.ts'])(
    '%s reaches outside the folder for nothing',
    (file) => {
      const body = read(`src/modules/webhook/resolve-info/${file}`);
      const outside = [...body.matchAll(/from\s+'([^']+)'/g)]
        .map((m) => m[1]!)
        .filter((i) => !i.startsWith('.'));
      expect({ file, outside }).toEqual({ file, outside: [] });
    },
  );

  it('it knows nothing about Nest, LINE, Mongo or the webhook', () => {
    for (const file of [
      'index.ts',
      'basic-register.ts',
      'resolve-info.types.ts',
    ]) {
      const body = read(`src/modules/webhook/resolve-info/${file}`);
      for (const forbidden of [
        '@nestjs',
        '@Injectable',
        'mongoose',
        'lineApi',
        'webhook.service',
      ]) {
        expect({ file, forbidden, has: body.includes(forbidden) }).toEqual({
          file,
          forbidden,
          has: false,
        });
      }
    }
  });

  it('and nothing here imports register/ — registration is only a caller', () => {
    /* the owner asked for this to be neutral. If it ever imports the thing that
       calls it, "anyone can call it" quietly stops being true. */
    for (const file of [
      'index.ts',
      'basic-register.ts',
      'resolve-info.types.ts',
    ]) {
      expect(read(`src/modules/webhook/resolve-info/${file}`)).not.toContain(
        'register/',
      );
    }
  });
});
