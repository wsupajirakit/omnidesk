/**
 * [FEAT-20260919-SHOWORIGSRC] `show_original_text_source` — the way in, the way
 * back, and the default that must not move.
 * ===========================================================================
 * The column records whether a room decides "แสดงข้อความต้นฉบับ" for itself or
 * defers to the operator's account-wide setting. It is worth a suite of its own
 * for two reasons, neither of which a rule test can cover:
 *
 *   1. **The default is load-bearing.** Not one row in any database carries this
 *      column on the day it ships, so `'all_rooms'` is what the entire installed
 *      base means — and `'all_rooms'` with an unset preference renders as OFF,
 *      exactly what those rooms do today. Move the default and every existing
 *      conversation changes appearance at once, with no migration to blame.
 *      Owner, 19/09: *"default ค่าใหม่คือ ใช้แบบทุกห้อง (preference)"*.
 *
 *   2. **It crosses three hand-written layers** and any one of them can drop it
 *      in silence, which reports to the operator as "it doesn't save":
 *        · `ValidationPipe` (`main.ts`, `whitelist` + `forbidNonWhitelisted`)
 *        · `updateRoomTranslateSettings` — copies `if (dto.x !== undefined)`
 *        · `resolveRoomTranslateSettings` — builds the RESPONSE field by field
 *      Layer 3 is the nastiest: the write succeeds, the screen re-reads, and the
 *      old value comes back. เขียนติดแล้วไม่พอ ต้องอ่านกลับได้ด้วย
 *
 * ⚠️ WHAT THIS DOES NOT PROVE: the HTTP transport and the auth guard. The pipe
 *    and the service run for real; the controller hands `dto` straight through
 *    with no field handling of its own, so that seam has no whitelist to get
 *    wrong.
 */
import { ValidationPipe, BadRequestException } from '@nestjs/common';

import { ChatService } from '@/modules/chat/chat.service';
import { UpdateRoomTranslateSettingsDto } from '@/modules/chat/dto/chat-room.dto';
import { ChatRoomSchema } from '@/modules/chat/schemas/chat-room.schema';
import { resolveRoomTranslateSettings } from '@/modules/chat/translate/room-translate-settings';

/** The pipe with the app's real options — the actual stripper, not a stand-in. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const through = (body: unknown): Promise<unknown> =>
  pipe.transform(body, {
    type: 'body',
    metatype: UpdateRoomTranslateSettingsDto as never,
  });

describe('[SHOWORIGSRC] layer 0 — the schema default is the whole installed base', () => {
  const path = () => ChatRoomSchema.path('show_original_text_source');

  it('🔴 defaults to `all_rooms`, so every existing row defers to the account', () => {
    expect(path()).toBeDefined();
    expect(path().options.default).toBe('all_rooms');
  });

  it('is a String with exactly the two known values', () => {
    expect(path().instance).toBe('String');
    expect(path().options.enum).toEqual(['all_rooms', 'room']);
  });

  it('🔴 the boolean it governs is UNCHANGED — this feature added, it did not alter', () => {
    /* The first design made `show_original_text` nullable. It could not ship:
       Mongoose writes schema defaults on upsert-insert and every room is born
       through one, so rooms created after 18/09 already hold a physical `false`
       that no operator chose — indistinguishable, under a nullable design, from
       a deliberate "off". Leaving this column exactly as it was is what makes
       the new one free of history. */
    const b = ChatRoomSchema.path('show_original_text');
    expect(b.instance).toBe('Boolean');
    expect(b.options.default).toBe(false);
  });
});

describe('[SHOWORIGSRC] layer 1 — the pipe must let it in', () => {
  it('🔴 survives the whitelist', async () => {
    const out = (await through({ show_original_text_source: 'room' })) as any;

    expect(out.show_original_text_source).toBe('room');
  });

  it.each([['all_rooms'], ['room']])('accepts %s', async (value) => {
    const out = (await through({ show_original_text_source: value })) as any;

    expect(out.show_original_text_source).toBe(value);
  });

  it.each([
    ['ค่านอก enum', 'rooms'],
    ['ตัวพิมพ์ใหญ่', 'ROOM'],
    ['ค่าว่าง', ''],
    ['boolean', true],
    ['ตัวเลข', 1],
  ])('🔴 rejects %s rather than storing it', async (_label, value) => {
    await expect(through({ show_original_text_source: value })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('🔴 rejects null — "no opinion" is expressed by `all_rooms`, not by absence', async () => {
    /* A second spelling for the same state is how two readers end up disagreeing.
       The column is never null: it is `all_rooms` or it is `room`. */
    await expect(through({ show_original_text_source: null })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('is optional — a request that says nothing about it still passes', async () => {
    const out = (await through({ show_original_text: true })) as any;

    expect(out.show_original_text).toBe(true);
    expect(out.show_original_text_source).toBeUndefined();
  });

  it('travels alongside the boolean in one request', async () => {
    const out = (await through({
      show_original_text: true,
      show_original_text_source: 'room',
    })) as any;

    expect(out).toEqual({
      show_original_text: true,
      show_original_text_source: 'room',
    });
  });
});

describe('[SHOWORIGSRC] layer 2 — the service writes it to the room', () => {
  /**
   * 🔴 THE REAL METHOD, NOT A COPY OF IT.
   *
   * The first version of this block re-implemented the two `if (dto.x !==
   * undefined)` lines against a plain object. It passed — and a mutation that
   * DELETED the real copy block from `chat.service.ts` passed too, because the
   * suite was asserting its own transcription rather than the code that ships.
   * A test that cannot fail when the feature is removed is decoration.
   * เทสที่ลอกโค้ดมาวางเอง = ไม่ได้เทสอะไรเลย
   *
   * `updateRoomTranslateSettings` is reached through the prototype with only the
   * two models it touches attached. Passing no `auth` skips the hook-scope
   * branch, which belongs to a different feature and has its own coverage.
   */
  const applyUpdate = async (
    stored: Record<string, unknown>,
    dto: Partial<UpdateRoomTranslateSettingsDto>,
  ) => {
    const room: Record<string, unknown> = {
      _id: 'a0d000000000000000000012',
      hook_id: null,
      ...stored,
      save: async () => undefined,
    };
    const svc = Object.create(ChatService.prototype);
    svc.chatRoomModel = { findById: async () => room };
    svc.hookModel = {
      findById: () => ({ select: () => ({ lean: async () => null }) }),
    };

    await svc.updateRoomTranslateSettings('a0d000000000000000000012', dto);
    return room;
  };

  it('writes the value it was given', async () => {
    const room = await applyUpdate({}, { show_original_text_source: 'room' });

    expect(room.show_original_text_source).toBe('room');
  });

  it('🔴 leaves it alone when the request does not mention it', async () => {
    // A save from step 1 or step 3 must not reset step 2's choice.
    const room = await applyUpdate(
      { show_original_text_source: 'room' },
      { show_original_text: true },
    );

    expect(room.show_original_text_source).toBe('room');
  });

  it('🔴 the two fields are independent — setting one does not move the other', async () => {
    /* Deliberate: a screen must be able to prepare the room's own value and
       adopt it afterwards, or adopt first and set the value after. */
    const adopted = await applyUpdate(
      { show_original_text: true, show_original_text_source: 'all_rooms' },
      { show_original_text_source: 'room' },
    );
    expect(adopted.show_original_text).toBe(true);

    const flipped = await applyUpdate(
      { show_original_text: true, show_original_text_source: 'room' },
      { show_original_text: false },
    );
    expect(flipped.show_original_text_source).toBe('room');
    expect(flipped.show_original_text).toBe(false);
  });
});

describe('[SHOWORIGSRC] layer 3 — the response carries it back', () => {
  it('🔴 a room that set it reads back as it set it', () => {
    const out = resolveRoomTranslateSettings(
      { show_original_text_source: 'room', show_original_text: true },
      null,
    );

    expect(out.show_original_text_source).toBe('room');
    expect(out.show_original_text).toBe(true);
  });

  it.each([
    ['ไม่มี field (แถวก่อน 19/09)', undefined],
    ['null', null],
    ['ค่าว่าง', ''],
    ['สะกดผิด', 'rooms'],
    ['ตัวพิมพ์ใหญ่', 'ROOM'],
    ['ผิดชนิด', 1],
  ])(
    '🔴 %s ตอบ all_rooms — ตกไปหาค่ากลางเสมอ ไม่ใช่บูลีนที่ไม่มีใครเลือก',
    (_label, raw) => {
      const out = resolveRoomTranslateSettings(
        { show_original_text_source: raw as never, show_original_text: true },
        null,
      );

      expect(out.show_original_text_source).toBe('all_rooms');
    },
  );

  it('a null room answers all_rooms too', () => {
    expect(
      resolveRoomTranslateSettings(null, null).show_original_text_source,
    ).toBe('all_rooms');
  });

  it('🔴 the raw boolean is still reported next to it', () => {
    /* The dashboard needs BOTH: the switch renders the room's own value even
       while the room defers, so the value is visible and comes back when the
       operator switches the source. */
    const out = resolveRoomTranslateSettings(
      { show_original_text_source: 'all_rooms', show_original_text: true },
      null,
    );

    expect(out.show_original_text).toBe(true);
    expect(out.show_original_text_source).toBe('all_rooms');
  });

  it('🔴 NO effective_show_original_text — the backend cannot know it', () => {
    /* The other half of the answer is a preference on the LOGGED-IN USER, and
       this function is handed a room and a hook. Two operators opening the same
       room may correctly see different things, so any "effective" value computed
       here would be wrong for somebody. The dashboard joins the two. */
    const out = resolveRoomTranslateSettings(
      { show_original_text: true },
      null,
    );

    expect(out).not.toHaveProperty('effective_show_original_text');
  });
});

describe('[SHOWORIGSRC] it changed nothing about auto-translate', () => {
  /* The one thing this feature must not do is disturb the room-OR-hook rule
     settled on 18/09. Same inputs, same answers, with the new column present. */
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('room=%s hook=%s → แปล %s', (roomAuto, hookAuto, expected) => {
    const out = resolveRoomTranslateSettings(
      {
        auto_translate: roomAuto,
        show_original_text_source: 'room',
        show_original_text: true,
      },
      { auto_translate: hookAuto },
    );

    expect(out.effective_auto_translate).toBe(expected);
  });

  it('the language precedence is untouched as well', () => {
    const out = resolveRoomTranslateSettings(
      { translate_lang: 'lo', show_original_text_source: 'room' },
      { translate_lang: 'en' },
    );

    expect(out.effective_translate_lang).toBe('lo');
  });
});
