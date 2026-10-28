/**
 * [FEAT-20260918-AUTOSENDCONFIRM] OUTBOUND CROSS MATRIX — every language × every switch
 * =============================================================================
 * Owner, 18/09: *"ทดสอบระบบส่งด้วย ไขว้ให้ครบ เปิด ปิด สลับภาษาขาออก ทั้งเข้าและขาออก
 * ต้องทดสอบ fallback error ด้วย กรณีแปลไม่สำเร็จ"*.
 *
 * The inbound matrix lives in the backend
 * (`omnidesk-api/z-test/unit/chat-auto-translate-matrix.spec.ts`) because that is
 * where the inbound decision lives. This is its outbound twin, and the two do
 * NOT mirror each other — that is the point:
 *
 *   inbound  : always into Thai · the operator reads it · never blocks a send
 *   outbound : into the CUSTOMER'S language · the customer reads it · blocks
 *
 * Driving the rule directly (it is a pure function) is what makes a full cross
 * affordable: every declared language against every source of that declaration,
 * which a DOM test could only sample. The DOM half — confirm, send, and every
 * failure path — is `composerAutoSendConfirm.dom.test.tsx`.
 */
import { describe, it, expect } from 'vitest';

import {
  outboundTargetLang,
  shouldAutoSendTranslated,
} from '../services/chat/outboundTranslateTarget';
import { TRANSLATE_LANGUAGES } from '../config/translateLanguages';

const CODES = TRANSLATE_LANGUAGES.map((l) => l.code);

describe('[AUTOSEND] the switch — when a send translates at all', () => {
  const base = { mode: 'reply', hasStagedTranslation: false, hasText: true };

  it('ON + a plain reply with text ⇒ translates', () => {
    expect(shouldAutoSendTranslated({ auto_send_translated: true }, base)).toBe(true);
  });

  it.each([
    ['the switch is off', { auto_send_translated: false }, base],
    ['the room never set it', {}, base],
    ['there is no room', null, base],
    ['an internal note, not a reply', { auto_send_translated: true }, { ...base, mode: 'note' }],
    ['the draft is empty', { auto_send_translated: true }, { ...base, hasText: false }],
    [
      'a manual translation is already staged',
      { auto_send_translated: true },
      { ...base, hasStagedTranslation: true },
    ],
  ])('%s ⇒ does not translate', (_name, room, opts) => {
    expect(shouldAutoSendTranslated(room as never, opts)).toBe(false);
  });

  it('🔴 an inline note NEVER goes through translation, even with the switch on', () => {
    // A note is internal and is never pushed to a customer. Translating one
    // would spend a vendor call to rewrite a message only staff will read.
    expect(
      shouldAutoSendTranslated({ auto_send_translated: true }, { ...base, mode: 'note' }),
    ).toBe(false);
  });
});

describe('[AUTOSEND] the language — switching the outbound target', () => {
  it('covers every language the console supports', () => {
    expect(CODES).toHaveLength(7);
  });

  it.each(CODES)('a room declaring %s replies in %s', (code) => {
    expect(outboundTargetLang({ translate_lang: code })).toBe(code);
  });

  it.each(CODES)('a hook defaulting to %s is used when the room declared nothing', (code) => {
    expect(outboundTargetLang({ translate_lang: null, hook_translate_lang: code })).toBe(code);
  });

  it.each(CODES)('an observed %s is used when nobody declared anything', (code) => {
    expect(outboundTargetLang({ detected_source_lang: code })).toBe(code);
  });

  describe('precedence — a declaration outranks an observation', () => {
    it('the room beats the hook', () => {
      expect(
        outboundTargetLang({ translate_lang: 'my', hook_translate_lang: 'lo' }),
      ).toBe('my');
    });

    it('the room beats what the model observed', () => {
      expect(
        outboundTargetLang({ translate_lang: 'km', detected_source_lang: 'en' }),
      ).toBe('km');
    });

    it('the hook beats what the model observed', () => {
      expect(
        outboundTargetLang({ hook_translate_lang: 'zh-Hant', detected_source_lang: 'en' }),
      ).toBe('zh-Hant');
    });

    it('the resolved effective value sits between the room and the hook', () => {
      expect(
        outboundTargetLang({
          effective_translate_lang: 'lo',
          hook_translate_lang: 'en',
          detected_source_lang: 'my',
        }),
      ).toBe('lo');
    });

    it('🔴 the full four-source cross always answers the highest-ranked one', () => {
      // 7 declared × 4 sources: whichever rank is present wins, in order.
      const ranks = [
        'translate_lang',
        'effective_translate_lang',
        'hook_translate_lang',
        'detected_source_lang',
      ] as const;

      let checked = 0;
      for (const code of CODES) {
        for (let i = 0; i < ranks.length; i += 1) {
          // Fill THIS rank with `code` and every LOWER rank with a different
          // language, so a wrong order shows up as the wrong answer.
          const room: Record<string, string> = { [ranks[i]!]: code };
          for (let j = i + 1; j < ranks.length; j += 1) {
            room[ranks[j]!] = code === 'en' ? 'km' : 'en';
          }
          expect(outboundTargetLang(room)).toBe(code);
          checked += 1;
        }
      }
      expect(checked).toBe(28);
    });
  });

  describe('🔴 nobody knows ⇒ null, never a guess', () => {
    it.each([
      ['an empty room object', {}],
      ['a null room', null],
      ['an undefined room', undefined],
      ['every field explicitly null', {
        translate_lang: null,
        effective_translate_lang: null,
        hook_translate_lang: null,
        detected_source_lang: null,
      }],
      ['every field an empty string', {
        translate_lang: '',
        effective_translate_lang: '',
        hook_translate_lang: '',
        detected_source_lang: '',
      }],
    ])('%s ⇒ null', (_name, room) => {
      expect(outboundTargetLang(room as never)).toBeNull();
    });

    it('never answers "en" by default — that was the bug', () => {
      // The previous implementation ended its chain with a literal 'en'.
      expect(outboundTargetLang({})).not.toBe('en');
    });
  });
});

describe('[AUTOSEND] switch × language, crossed', () => {
  it('all 7 languages × 4 switch states agree with the rules', () => {
    const base = { mode: 'reply', hasStagedTranslation: false, hasText: true };
    const switches: Array<[string, boolean | undefined]> = [
      ['on', true],
      ['off', false],
      ['never set', undefined],
    ];

    let checked = 0;
    let willTranslate = 0;

    for (const code of CODES) {
      for (const [, sw] of switches) {
        const room = {
          ...(sw === undefined ? {} : { auto_send_translated: sw }),
          translate_lang: code,
        };
        const on = shouldAutoSendTranslated(room, base);
        const target = outboundTargetLang(room);

        expect(on).toBe(sw === true);
        // The target is resolved regardless of the switch — the switch decides
        // whether it is USED, and mixing the two would make an off room resolve
        // to null and look like "unknown language" in a log.
        expect(target).toBe(code);

        checked += 1;
        if (on) willTranslate += 1;
      }
    }

    expect(checked).toBe(21);
    expect(willTranslate).toBe(7); // one per language, only in the "on" state
  });

  it('a room with the switch ON but no language resolves to null in every case', () => {
    const base = { mode: 'reply', hasStagedTranslation: false, hasText: true };
    const room = { auto_send_translated: true };

    expect(shouldAutoSendTranslated(room, base)).toBe(true);
    expect(outboundTargetLang(room as never)).toBeNull();
    // ⇒ the send path translates nothing and delivers the draft as typed.
    // Proved end to end in composerAutoSendConfirm.dom.test.tsx.
  });
});
