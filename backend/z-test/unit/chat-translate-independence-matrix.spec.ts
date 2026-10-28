/**
 * [FEAT-20260919-SHOWORIGSRC] The two settings must not be able to touch each other.
 * ===========================================================================
 * `chat-show-original-source.spec.ts` proves the new column behaves. This file
 * proves something different and, for a change landing on a live flow, more
 * important: that adding it did NOT move the auto-translate decision anywhere.
 *
 * ## Why a sample is not enough here
 *
 * Both features read the SAME room document through the SAME resolver
 * (`resolveRoomTranslateSettings`), and one of them — `shouldAutoTranslateInbound`
 * — decides whether a customer's message gets sent to a paid vendor. A coupling
 * introduced by accident would not throw: it would translate a room that asked
 * for nothing, or go quiet on a room that asked for everything, and the only
 * symptom would be a bill or a complaint days later.
 *
 * So the check is not "try a few combinations". It is: for EVERY auto-translate
 * input, sweep EVERY display-setting combination and assert the answer does not
 * move. Invariance across a full sweep is a proof of independence; a passing
 * sample is only an absence of evidence. ไขว้ทุกช่องจริง ไม่ใช่สุ่มดู
 *
 * And the reverse direction too — the display answer must not move when the
 * translate switches do. A one-way check would miss a resolver that read
 * `auto_translate` while deciding what to show.
 */
import {
  resolveRoomTranslateSettings,
  type HookTranslateFields,
  type RoomTranslateFields,
} from '@/modules/chat/translate/room-translate-settings';
import {
  INBOUND_TARGET,
  shouldAutoTranslateInbound,
} from '@/modules/chat/translate/auto/should-auto-translate';

/* ── the display half: every shape a room can be in ──────────────────────── */
const DISPLAY_VARIANTS: Array<{
  label: string;
  fields: Pick<
    RoomTranslateFields,
    'show_original_text' | 'show_original_text_source'
  >;
}> = [];
for (const source of [
  'room',
  'all_rooms',
  undefined,
  null,
  'garbage',
] as const) {
  for (const value of [true, false, undefined] as const) {
    DISPLAY_VARIANTS.push({
      label: `source=${String(source)} value=${String(value)}`,
      fields: {
        show_original_text: value,
        show_original_text_source: source,
      },
    });
  }
}

/* ── the translate half ──────────────────────────────────────────────────── */
const ROOM_AUTO = [true, false, null, undefined] as const;
const HOOK_AUTO = [true, false, undefined] as const;
const ROOM_LANG = ['lo', '', null, undefined] as const;
const HOOK_LANG = ['en', '', null, undefined] as const;

/** The owner's rule, 18/09: either level may switch it on. */
const expectedAuto = (
  roomAuto: (typeof ROOM_AUTO)[number],
  hookAuto: (typeof HOOK_AUTO)[number],
) => Boolean(roomAuto) || Boolean(hookAuto);

describe('[INDEPENDENCE] the display setting cannot move `effective_auto_translate`', () => {
  it('🔴 sweeps every display shape against every switch pair — 180 combinations', () => {
    /* 4 room states × 3 hook states × 15 display shapes. Written as one case
       with an explicit counter rather than `it.each` so an early return or a
       typo in the loop cannot quietly reduce the sweep to nothing — a common
       way for a matrix test to pass while measuring a fraction of what it says.
       นับจำนวนที่เดินจริง ไม่งั้น loop พังแล้วยังเขียว */
    let checked = 0;

    for (const roomAuto of ROOM_AUTO) {
      for (const hookAuto of HOOK_AUTO) {
        const expected = expectedAuto(roomAuto, hookAuto);

        for (const variant of DISPLAY_VARIANTS) {
          const out = resolveRoomTranslateSettings(
            { auto_translate: roomAuto, ...variant.fields },
            hookAuto === undefined ? {} : { auto_translate: hookAuto },
          );

          expect({
            case: `room=${String(roomAuto)} hook=${String(hookAuto)} ${variant.label}`,
            auto: out.effective_auto_translate,
          }).toEqual({
            case: `room=${String(roomAuto)} hook=${String(hookAuto)} ${variant.label}`,
            auto: expected,
          });
          checked += 1;
        }
      }
    }

    expect(checked).toBe(
      ROOM_AUTO.length * HOOK_AUTO.length * DISPLAY_VARIANTS.length,
    );
    expect(checked).toBe(180);
  });

  it('the room-level `auto_translate` it reports back is untouched too', () => {
    for (const variant of DISPLAY_VARIANTS) {
      expect(
        resolveRoomTranslateSettings(
          { auto_translate: true, ...variant.fields },
          {},
        ).auto_translate,
      ).toBe(true);
      expect(
        resolveRoomTranslateSettings(
          { auto_translate: false, ...variant.fields },
          {},
        ).auto_translate,
      ).toBe(false);
    }
  });
});

describe('[INDEPENDENCE] the display setting cannot move `effective_translate_lang`', () => {
  it('🔴 sweeps every display shape against every language pair — 240 combinations', () => {
    let checked = 0;

    for (const roomLang of ROOM_LANG) {
      for (const hookLang of HOOK_LANG) {
        // room first, hook second — empty string and null both mean "unset"
        const expected = roomLang || hookLang || null;

        for (const variant of DISPLAY_VARIANTS) {
          const out = resolveRoomTranslateSettings(
            { translate_lang: roomLang, ...variant.fields },
            { translate_lang: hookLang },
          );

          expect({
            case: `room=${String(roomLang)} hook=${String(hookLang)} ${variant.label}`,
            lang: out.effective_translate_lang,
          }).toEqual({
            case: `room=${String(roomLang)} hook=${String(hookLang)} ${variant.label}`,
            lang: expected,
          });
          checked += 1;
        }
      }
    }

    expect(checked).toBe(
      ROOM_LANG.length * HOOK_LANG.length * DISPLAY_VARIANTS.length,
    );
    expect(checked).toBe(240);
  });

  it('`detected_source_lang` is still reported separately and unaffected', () => {
    for (const variant of DISPLAY_VARIANTS) {
      const out = resolveRoomTranslateSettings(
        { translate_lang: 'lo', detected_source_lang: 'my', ...variant.fields },
        {},
      );

      expect(out.translate_lang).toBe('lo');
      expect(out.detected_source_lang).toBe('my');
    }
  });
});

describe('[INDEPENDENCE] the display setting cannot move the INBOUND decision', () => {
  /* The real sentences this flow was fired with live on 18/09 — one per
     language the owner asked to be covered. */
  const MESSAGES: Array<[string, string, boolean]> = [
    ['ไทย', 'สวัสดีครับ วันนี้ยอดเท่าไหร่', false],
    ['อังกฤษ', 'Hello, can I check my balance?', true],
    ['ลาว', 'ສະບາຍດີ ຂ້ອຍຢາກຖອນເງິນ', true],
    ['เขมร', 'សួស្តី ខ្ញុំចង់ដកប្រាក់', true],
    ['พม่า', 'မင်္ဂလာပါ ကျွန်တော် ငွေထုတ်ချင်ပါတယ်', true],
    ['จีนเต็ม', '你好，我想查詢餘額', true],
    ['จีนย่อ', '你好，我想查询余额', true],
    ['เวียดนาม', 'Xin chào, tôi muốn rút tiền', true],
  ];

  it('🔴 every language × every switch pair × every display shape — 1,440 combinations', () => {
    let checked = 0;

    for (const [, text, isForeign] of MESSAGES) {
      for (const roomAuto of ROOM_AUTO) {
        for (const hookAuto of HOOK_AUTO) {
          const on = expectedAuto(roomAuto, hookAuto);
          /* What the decision must be, derived from the translate inputs ALONE.
             If any display field could reach this, one of the 15 variants below
             would disagree with it. */
          const expected = !on
            ? { translate: false, reason: 'auto-translate-off' }
            : isForeign
              ? { translate: true, to: INBOUND_TARGET }
              : { translate: false, reason: 'already-in-target' };

          for (const variant of DISPLAY_VARIANTS) {
            const decision = shouldAutoTranslateInbound({
              senderType: 'customer',
              messageType: 'text',
              content: text,
              room: { auto_translate: roomAuto, ...variant.fields },
              hook: hookAuto === undefined ? {} : { auto_translate: hookAuto },
            });

            expect(decision).toEqual(expected);
            checked += 1;
          }
        }
      }
    }

    expect(checked).toBe(
      MESSAGES.length *
        ROOM_AUTO.length *
        HOOK_AUTO.length *
        DISPLAY_VARIANTS.length,
    );
    expect(checked).toBe(1440);
  });

  it('🔴 the refusals that run BEFORE any setting is read are unchanged', () => {
    /* These short-circuit ahead of the resolver, so a display field could only
       reach them through a change nobody intended. Swept anyway — this is the
       branch that keeps stickers, images and the operator's own words out of a
       paid vendor call. */
    const REFUSALS: Array<[string, Record<string, unknown>, string]> = [
      [
        'ข้อความของแอดมินเอง',
        { senderType: 'admin', messageType: 'text', content: 'hi' },
        'not-a-customer-message',
      ],
      [
        'รูป',
        { senderType: 'customer', messageType: 'image', content: 'x' },
        'not-text',
      ],
      [
        'สติกเกอร์',
        { senderType: 'customer', messageType: 'sticker', content: 'x' },
        'not-text',
      ],
      [
        'ว่าง',
        { senderType: 'customer', messageType: 'text', content: '   ' },
        'empty',
      ],
      [
        'อีโมจิล้วน',
        { senderType: 'customer', messageType: 'text', content: '😀😀' },
        'nothing-to-translate',
      ],
      [
        'ลิงก์ล้วน',
        {
          senderType: 'customer',
          messageType: 'text',
          content: 'https://a.co/x',
        },
        'nothing-to-translate',
      ],
      [
        'ตัวเลขล้วน',
        { senderType: 'customer', messageType: 'text', content: '1,500.00' },
        'nothing-to-translate',
      ],
    ];

    for (const [, input, reason] of REFUSALS) {
      for (const variant of DISPLAY_VARIANTS) {
        expect(
          shouldAutoTranslateInbound({
            ...input,
            // switches fully ON, so only the refusal can produce a `false`
            room: { auto_translate: true, ...variant.fields },
            hook: { auto_translate: true },
          }),
        ).toEqual({ translate: false, reason });
      }
    }
  });
});

describe('[INDEPENDENCE] …and the reverse: translate switches cannot move the display answer', () => {
  it('🔴 `show_original_text_source` is invariant across every switch and language pair', () => {
    /* The direction that is easy to forget. A resolver that read `auto_translate`
       while deciding what to SHOW would pass every test above. */
    let checked = 0;

    for (const roomAuto of ROOM_AUTO) {
      for (const hookAuto of HOOK_AUTO) {
        for (const roomLang of ROOM_LANG) {
          for (const variant of DISPLAY_VARIANTS) {
            const out = resolveRoomTranslateSettings(
              {
                auto_translate: roomAuto,
                translate_lang: roomLang,
                auto_send_translated: true,
                ...variant.fields,
              },
              hookAuto === undefined ? {} : { auto_translate: hookAuto },
            );

            expect(out.show_original_text_source).toBe(
              variant.fields.show_original_text_source === 'room'
                ? 'room'
                : 'all_rooms',
            );
            expect(out.show_original_text).toBe(
              variant.fields.show_original_text === true,
            );
            checked += 1;
          }
        }
      }
    }

    expect(checked).toBe(
      ROOM_AUTO.length *
        HOOK_AUTO.length *
        ROOM_LANG.length *
        DISPLAY_VARIANTS.length,
    );
    expect(checked).toBe(720);
  });

  it('`auto_send_translated` is carried through untouched as well', () => {
    for (const variant of DISPLAY_VARIANTS) {
      expect(
        resolveRoomTranslateSettings(
          { auto_send_translated: true, ...variant.fields },
          {},
        ).auto_send_translated,
      ).toBe(true);
      expect(
        resolveRoomTranslateSettings(
          { auto_send_translated: false, ...variant.fields },
          {},
        ).auto_send_translated,
      ).toBe(false);
    }
  });
});

describe('[INDEPENDENCE] a room with NOTHING set behaves exactly as it did', () => {
  /* The shape of 20 of the 21 rooms in the reference database, and of every room
     on the day this ships. */
  const EMPTY_ROOM: RoomTranslateFields = {};
  const NO_HOOK: HookTranslateFields | null = null;

  it('does not translate, has no language, and shows no original', () => {
    const out = resolveRoomTranslateSettings(EMPTY_ROOM, NO_HOOK);

    expect(out.effective_auto_translate).toBe(false);
    expect(out.effective_translate_lang).toBeNull();
    expect(out.show_original_text).toBe(false);
    expect(out.show_original_text_source).toBe('all_rooms');
  });

  it('…and an inbound foreign message is left alone', () => {
    expect(
      shouldAutoTranslateInbound({
        senderType: 'customer',
        messageType: 'text',
        content: 'Hello, can I check my balance?',
        room: EMPTY_ROOM,
        hook: NO_HOOK,
      }),
    ).toEqual({ translate: false, reason: 'auto-translate-off' });
  });

  it('🔴 the OA alone can still switch it on — the 18/09 rule, still standing', () => {
    expect(
      shouldAutoTranslateInbound({
        senderType: 'customer',
        messageType: 'text',
        content: 'Hello, can I check my balance?',
        room: EMPTY_ROOM,
        hook: { auto_translate: true },
      }),
    ).toEqual({ translate: true, to: INBOUND_TARGET });
  });
});
