/**
 * [FEAT-20260918-AUTOTRANS] THE FULL CROSS MATRIX — every language × every switch
 * =============================================================================
 * Owner, 18/09: *"ย้ำว่าทุกเคส ไทย ไม่ไทย เขมร พม่า eng ส่งเข้ามา (ต้องแปลไทยตามเงื่อนไข)
 * ทดสอบเปิด ปิดด้วย ระดับห้อง ระดับ hook ไขว้เทสให้ครบ และเทส negative ด้วย"*.
 *
 * The sibling file `chat-auto-translate-inbound.spec.ts` proves each rule once.
 * This one crosses them: every supported language against every combination of
 * the room switch and the hook switch, so a rule that is right on its own but
 * wrong in combination cannot hide.
 *
 * ## The two rules the whole matrix rests on
 *
 * 1. **WHETHER** — EITHER LEVEL MAY SWITCH IT ON (owner's rule, 18/09). The
 *    effective answer is `room OR hook`; a room's `false` means "this room asks
 *    for nothing", not "mute this room", so translation stops only when BOTH are
 *    off. The earlier rule let a room's `false` beat the hook, which is what made
 *    an OA-level switch appear to do nothing.
 * 2. **WHAT INTO** — always Thai. The room's own language field is the
 *    CUSTOMER's language, kept for translating replies back out; using it here
 *    would translate a customer's Khmer into Khmer. Thai in is skipped entirely,
 *    which is the owner's "ไทยเราไม่แปล".
 *
 * Counts are asserted at the end of each block so a case silently disappearing
 * from a table is itself a failure.
 */

import {
  INBOUND_TARGET,
  shouldAutoTranslateInbound,
  type AutoTranslateDecision,
} from '@/modules/chat/translate/auto/should-auto-translate';
import { TRANSLATE_LANGUAGE_CODES } from '@/modules/ai-translate';

/** One real sentence per supported language — a customer asking about money. */
const SAMPLES: Record<string, string> = {
  th: 'สวัสดีครับ ขอสอบถามยอดหน่อยครับ',
  en: 'Hello, I would like to check my balance',
  my: 'မင်္ဂလာပါ ကျွန်တော့်လက်ကျန်ငွေ စစ်ချင်ပါတယ်',
  'zh-Hans': '你好，我想查一下余额',
  'zh-Hant': '你好，我想查一下餘額',
  lo: 'ສະບາຍດີ ຂ້ອຍຢາກກວດຍອດເງິນ',
  km: 'សួស្តី ខ្ញុំចង់ពិនិត្យសមតុល្យ',
};

/** Thai is the one language that is already readable, so it is never spent on. */
const FOREIGN = ['en', 'my', 'zh-Hans', 'zh-Hant', 'lo', 'km'] as const;

const ask = (
  lang: string,
  room: Record<string, unknown> | null,
  hook: Record<string, unknown> | null,
): AutoTranslateDecision =>
  shouldAutoTranslateInbound({
    senderType: 'customer',
    messageType: 'text',
    content: SAMPLES[lang],
    room,
    hook,
  });

describe('[FEAT-20260918-AUTOTRANS] matrix — the language that arrives', () => {
  it('the sample set covers every language the console supports', () => {
    // If a language is added to the registry and not here, this fails rather
    // than letting the matrix quietly shrink.
    expect(Object.keys(SAMPLES).sort()).toEqual(
      [...TRANSLATE_LANGUAGE_CODES].sort(),
    );
  });

  describe('switched ON — a foreign line is read into Thai, whatever it is', () => {
    it.each(FOREIGN)('%s → th', (lang) => {
      expect(ask(lang, { auto_translate: true }, {})).toEqual({
        translate: true,
        to: INBOUND_TARGET,
      });
    });

    it('🔴 Thai in ⇒ nothing spent, even with the switch on ("ไทยเราไม่แปล")', () => {
      expect(ask('th', { auto_translate: true }, {})).toEqual({
        translate: false,
        reason: 'already-in-target',
      });
    });

    it('every foreign language answers `th`, and none answers its own code', () => {
      const targets = FOREIGN.map((l) => {
        const d = ask(l, { auto_translate: true }, {});
        return d.translate ? d.to : null;
      });

      expect(targets).toEqual(['th', 'th', 'th', 'th', 'th', 'th']);
      expect(targets).toHaveLength(6);
    });
  });
});

describe('[FEAT-20260918-AUTOTRANS] matrix — room switch × hook switch', () => {
  /* The four states of the room switch against the three of the hook.
     `undefined` = the column does not exist on the row at all, which is what
     every OA that predates this feature looks like. */
  const ROOM: Array<[string, boolean | null | undefined]> = [
    ['room ON', true],
    ['room OFF', false],
    ['room unset (null)', null],
    ['room has no column', undefined],
  ];
  const HOOK: Array<[string, boolean | undefined]> = [
    ['hook ON', true],
    ['hook OFF', false],
    ['hook has no column', undefined],
  ];

  /* 🔴 EITHER LEVEL MAY SWITCH IT ON (owner's rule, 18/09). A room's `false` is
     not a mute — it means "this room asks for nothing" — so the answer is the OR
     and translation stops only when both are off. The previous rule ("room wins
     when set") is what made an OA switch unable to reach a room saved as false.
     เปิดที่ไหนก็ได้ · ปิดต้องปิดทั้งสองที่ */
  const expected = (
    room: boolean | null | undefined,
    hook: boolean | undefined,
  ): boolean => Boolean(room) || Boolean(hook);

  const cases = ROOM.flatMap(([rName, rVal]) =>
    HOOK.map(([hName, hVal]) => [`${rName} + ${hName}`, rVal, hVal] as const),
  );

  it('covers all twelve combinations', () => {
    expect(cases).toHaveLength(12);
  });

  it.each(cases)('%s', (_name, rVal, hVal) => {
    const room = rVal === undefined ? {} : { auto_translate: rVal };
    const hook = hVal === undefined ? {} : { auto_translate: hVal };
    const d = ask('my', room, hook);

    if (expected(rVal, hVal)) {
      expect(d).toEqual({ translate: true, to: 'th' });
    } else {
      expect(d).toEqual({ translate: false, reason: 'auto-translate-off' });
    }
  });

  it('🔴 the two that matter most — one switch on either level is enough', () => {
    // room OFF + hook ON ⇒ translates. This is the case the owner hit on 18/09
    // when the OA switch appeared to do nothing.
    expect(
      ask('my', { auto_translate: false }, { auto_translate: true }),
    ).toEqual({
      translate: true,
      to: 'th',
    });
    // room ON + hook OFF ⇒ translates too. Symmetric by construction.
    expect(
      ask('my', { auto_translate: true }, { auto_translate: false }),
    ).toEqual({
      translate: true,
      to: 'th',
    });
  });

  it('🔴 both off is the ONLY combination that stops translation', () => {
    const stopped = [
      ask('my', { auto_translate: false }, { auto_translate: false }),
      ask('my', { auto_translate: false }, {}),
      ask('my', {}, { auto_translate: false }),
      ask('my', {}, {}),
      ask('my', { auto_translate: null }, {}),
    ];

    for (const d of stopped) {
      expect(d).toEqual({ translate: false, reason: 'auto-translate-off' });
    }
  });

  it('🔴 an OA that never opened the feature translates nothing, in any language', () => {
    const results = Object.keys(SAMPLES).map((l) => ask(l, {}, {}).translate);

    expect(results).toEqual([false, false, false, false, false, false, false]);
  });
});

describe('[FEAT-20260918-AUTOTRANS] matrix — language × switch, crossed', () => {
  /* The full cross: 7 languages × 12 switch combinations = 84 decisions, each
     asserted against the two rules rather than against a table someone typed. */
  it('all 84 combinations agree with the rules', () => {
    const langs = Object.keys(SAMPLES);
    const rooms: Array<boolean | null | undefined> = [
      true,
      false,
      null,
      undefined,
    ];
    const hooks: Array<boolean | undefined> = [true, false, undefined];

    let checked = 0;
    const translated: string[] = [];

    for (const lang of langs) {
      for (const r of rooms) {
        for (const h of hooks) {
          const room = r === undefined ? {} : { auto_translate: r };
          const hook = h === undefined ? {} : { auto_translate: h };
          const d = ask(lang, room, hook);
          checked += 1;

          const on = Boolean(r) || Boolean(h);

          if (!on) {
            expect(d).toEqual({
              translate: false,
              reason: 'auto-translate-off',
            });
          } else if (lang === 'th') {
            expect(d).toEqual({
              translate: false,
              reason: 'already-in-target',
            });
          } else {
            expect(d).toEqual({ translate: true, to: 'th' });
            translated.push(`${lang}:${String(r)}/${String(h)}`);
          }
        }
      }
    }

    expect(checked).toBe(84);
    /* 6 foreign languages × 6 "on" combinations = 36 actual vendor calls.
       Six, not five: `room ON` is on against all three hook states (3), and the
       three "room asks for nothing" values (false / null / absent) are each on
       when the hook is on (3). Under the old rule `room OFF` was on against
       nothing, which is exactly what changed.
       Thai is excluded at every combination — 12 of the 84 are Thai and none of
       them spends anything. */
    expect(translated).toHaveLength(36);
  });
});

describe('[FEAT-20260918-AUTOTRANS] matrix — the declared customer language never becomes the target', () => {
  /* 🔴 THIS BLOCK EXISTS BECAUSE THE MATRIX HAD A HOLE.
     Every case above leaves `translate_lang` unset, so `effective_translate_lang`
     is always null — and a mutation that made the target
     `effective_translate_lang || 'th'` stayed GREEN across all 49 cases. The rule
     "inbound always reads into Thai" was therefore not being measured at all.
     These cases set a customer language on the room and on the hook, which is
     the state every configured room is actually in.
     เทสที่ไม่เคยตั้งค่า = ไม่ได้วัดกฎข้อนั้นเลย */

  const langs = Object.keys(SAMPLES);

  it('a room that declares each of the seven languages still reads into Thai', () => {
    const targets: string[] = [];

    for (const declared of langs) {
      for (const incoming of FOREIGN) {
        const d = ask(
          incoming,
          { auto_translate: true, translate_lang: declared },
          {},
        );
        expect(d).toEqual({ translate: true, to: 'th' });
        if (d.translate) targets.push(d.to);
      }
    }

    expect(targets).toHaveLength(42); // 7 declared × 6 incoming
    expect(new Set(targets)).toEqual(new Set(['th']));
  });

  it('a hook default language does not become the target either', () => {
    for (const declared of langs) {
      const d = ask(
        'km',
        { auto_translate: true },
        { translate_lang: declared },
      );

      expect(d).toEqual({ translate: true, to: 'th' });
    }
  });

  it('🔴 a Burmese room receiving Burmese is read into Thai, not into Burmese', () => {
    // The shape the bug produced: translating a customer's own language back
    // into itself, paying a vendor call to return the line unchanged.
    const d = ask('my', { auto_translate: true, translate_lang: 'my' }, {});

    expect(d).toEqual({ translate: true, to: 'th' });
  });

  it('a Thai-declared room receiving Thai still skips, and spends nothing', () => {
    expect(
      ask('th', { auto_translate: true, translate_lang: 'th' }, {}),
    ).toEqual({
      translate: false,
      reason: 'already-in-target',
    });
  });
});

describe('[FEAT-20260918-AUTOTRANS] matrix — negative, with the switch ON', () => {
  const ON = { auto_translate: true };

  /* Everything below reaches the funnel with translation enabled and must still
     cost nothing. Each row is a real shape seen in `chat_messages`. */
  const NEGATIVE: Array<[string, Record<string, unknown>, string]> = [
    ['the bot replying', { senderType: 'bot' }, 'not-a-customer-message'],
    ['an admin replying', { senderType: 'admin' }, 'not-a-customer-message'],
    ['a system divider', { senderType: 'system' }, 'not-a-customer-message'],
    ['no sender at all', { senderType: undefined }, 'not-a-customer-message'],
    ['an image', { messageType: 'image' }, 'not-text'],
    ['a video', { messageType: 'video' }, 'not-text'],
    ['a video still uploading', { messageType: 'video_pending' }, 'not-text'],
    ['a sticker', { messageType: 'sticker' }, 'not-text'],
    ['a flex card', { messageType: 'flex' }, 'not-text'],
    ['an inline note', { messageType: 'inline_note' }, 'not-text'],
    ['an empty body', { content: '' }, 'empty'],
    ['spaces and newlines only', { content: ' \n\t ' }, 'empty'],
    ['a non-string body', { content: { text: 'hi' } }, 'empty'],
    ['a null body', { content: null }, 'empty'],
    ['one emoji', { content: '👍' }, 'nothing-to-translate'],
    ['several emoji', { content: '😀😀🙏' }, 'nothing-to-translate'],
    ['an amount', { content: '1,500' }, 'nothing-to-translate'],
    ['an account number', { content: '123-4-56789-0' }, 'nothing-to-translate'],
    [
      'a bare link',
      { content: 'https://line.me/R/ti/p/@abc' },
      'nothing-to-translate',
    ],
    ['punctuation', { content: '!!!???' }, 'nothing-to-translate'],
  ];

  it('covers twenty refusal shapes', () => {
    expect(NEGATIVE).toHaveLength(20);
  });

  it.each(NEGATIVE)('%s ⇒ %s', (_name, override, reason) => {
    const d = shouldAutoTranslateInbound({
      senderType: 'customer',
      messageType: 'text',
      content: SAMPLES.my,
      room: ON,
      hook: {},
      ...override,
    });

    expect(d).toEqual({ translate: false, reason });
  });

  it('a link WITH a sentence around it is still translated', () => {
    // The refusal is "there is no sentence here", not "there is a link here".
    const d = shouldAutoTranslateInbound({
      senderType: 'customer',
      messageType: 'text',
      content: 'ဒီလင့်ကို ကြည့်ပေးပါ https://example.com',
      room: ON,
      hook: {},
    });

    expect(d).toEqual({ translate: true, to: 'th' });
  });

  it('a Thai sentence with a foreign word in it IS translated', () => {
    // "already Thai" has to be certain; a mixed line is not, and the foreign
    // half may be the part the operator cannot read.
    const d = shouldAutoTranslateInbound({
      senderType: 'customer',
      messageType: 'text',
      content: 'โอนแล้วนะ transfer done',
      room: ON,
      hook: {},
    });

    expect(d).toEqual({ translate: true, to: 'th' });
  });

  it('digits inside a foreign sentence do not make it untranslatable', () => {
    const d = shouldAutoTranslateInbound({
      senderType: 'customer',
      messageType: 'text',
      content: 'ငွေ 500 သွင်းပြီးပါပြီ',
      room: ON,
      hook: {},
    });

    expect(d).toEqual({ translate: true, to: 'th' });
  });
});
