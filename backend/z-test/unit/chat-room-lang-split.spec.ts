/**
 * [FIX-20260918-LANGSPLIT] The bug this spec exists to keep dead
 * =============================================================================
 * `translate_lang` used to hold two different answers: the TARGET the operator
 * chose, and the SOURCE the vendor detected. The translate path wrote the second
 * one into the field that held the first, so a room set to `en` silently became
 * `my` the moment a Burmese message was translated in it.
 *
 * Real rows in `local_db_10_aug_26` show `translations[].from` is populated 19
 * times out of 28, so this fired on most translations, not on a rare race.
 *
 * Every case below drives the REAL exported functions — no re-implementation of
 * the rule inside the test. Deleting the guard in `remember-source-lang.ts` or
 * flipping a branch in `room-translate-settings.ts` must turn one of these red.
 */

import {
  rememberDetectedSourceLang,
  type RoomSourceLangWriter,
} from '@/modules/chat/translate/remember-source-lang';
import { resolveRoomTranslateSettings } from '@/modules/chat/translate/room-translate-settings';

/** Records every updateOne it is handed, so filter AND update can be asserted. */
function fakeRoomModel(): RoomSourceLangWriter & {
  calls: Array<{
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  }>;
} {
  const calls: Array<{
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];
  return {
    calls,
    updateOne(filter, update) {
      calls.push({ filter, update });
      return Promise.resolve({ acknowledged: true });
    },
  };
}

describe('[FIX-20260918-LANGSPLIT] detected source never touches the target', () => {
  describe('rememberDetectedSourceLang — positive cases, one per language', () => {
    // The seven the console supports, in the owner's display order.
    const LANGS = ['th', 'en', 'my', 'zh-Hans', 'zh-Hant', 'lo', 'km'];

    it.each(LANGS)(
      'stores %s in detected_source_lang, never in translate_lang',
      async (lang) => {
        const model = fakeRoomModel();

        const wrote = await rememberDetectedSourceLang(model, {
          roomId: 'room-1',
          from: lang,
        });

        expect(wrote).toBe(true);
        expect(model.calls).toHaveLength(1);
        expect(model.calls[0]!.update).toEqual({
          $set: { detected_source_lang: lang },
        });
        // 🔴 the whole point: the operator's chosen target is not in this write.
        expect(JSON.stringify(model.calls[0]!.update)).not.toContain(
          'translate_lang"',
        );
      },
    );

    it('asks the database to skip the write when the value already matches', async () => {
      const model = fakeRoomModel();

      await rememberDetectedSourceLang(model, { roomId: 'room-1', from: 'my' });

      // The "has it changed" test rides in the FILTER — one round trip, no read.
      expect(model.calls[0]!.filter).toEqual({
        _id: 'room-1',
        detected_source_lang: { $ne: 'my' },
      });
    });
  });

  describe('rememberDetectedSourceLang — negative cases write nothing at all', () => {
    const REFUSED: Array<[string, string | null | undefined]> = [
      ['null (the model detected nothing — 9 of 28 real rows)', null],
      ['undefined (older entries have no `from` key)', undefined],
      ['empty string', ''],
      ['"auto" (a vendor placeholder, not a language)', 'auto'],
      ['"und" (ISO undetermined)', 'und'],
      ['"ja" (a real language this console does not support)', 'ja'],
      ['"TH" (right language, wrong case — the registry is exact)', 'TH'],
      ['"th-TH" (a locale, not one of the seven codes)', 'th-TH'],
    ];

    it.each(REFUSED)('refuses %s', async (_label, from) => {
      const model = fakeRoomModel();

      const wrote = await rememberDetectedSourceLang(model, {
        roomId: 'room-1',
        from,
      });

      expect(wrote).toBe(false);
      expect(model.calls).toHaveLength(0);
    });

    it('refuses when the message has no room', async () => {
      const model = fakeRoomModel();

      const wrote = await rememberDetectedSourceLang(model, {
        roomId: undefined,
        from: 'en',
      });

      expect(wrote).toBe(false);
      expect(model.calls).toHaveLength(0);
    });

    it('a failing database never breaks the translation the admin is waiting for', async () => {
      const exploding: RoomSourceLangWriter = {
        updateOne() {
          return Promise.reject(new Error('mongo is down'));
        },
      };

      await expect(
        rememberDetectedSourceLang(exploding, { roomId: 'r', from: 'en' }),
      ).resolves.toBe(false);
    });
  });

  describe('resolveRoomTranslateSettings — room first, hook second', () => {
    it('keeps the target the operator chose and reports the source separately', () => {
      const out = resolveRoomTranslateSettings(
        { translate_lang: 'en', detected_source_lang: 'my' },
        { translate_lang: 'th', auto_translate: true },
      );

      expect(out.translate_lang).toBe('en');
      expect(out.detected_source_lang).toBe('my');
      expect(out.effective_translate_lang).toBe('en');
    });

    it('falls back to the hook only when the room has no target', () => {
      const out = resolveRoomTranslateSettings(
        { translate_lang: null },
        { translate_lang: 'zh-Hant' },
      );

      expect(out.effective_translate_lang).toBe('zh-Hant');
    });

    it('answers null when neither side chose one', () => {
      expect(
        resolveRoomTranslateSettings({}, {}).effective_translate_lang,
      ).toBeNull();
    });

    it('🔴 a room OFF still follows a hook that is ON — either level may enable it', () => {
      /* CHANGED 18/09, owner's rule. The previous version asserted that a room's
         `false` overrode the hook, which is what made an OA-level switch unable
         to reach a room that had ever been saved off. `auto_translate` still
         reports what the ROOM holds; only the effective answer is the OR. */
      const out = resolveRoomTranslateSettings(
        { auto_translate: false },
        { auto_translate: true },
      );

      expect(out.auto_translate).toBe(false);
      expect(out.effective_auto_translate).toBe(true);
    });

    it('only both-off actually stops translation', () => {
      const out = resolveRoomTranslateSettings(
        { auto_translate: false },
        { auto_translate: false },
      );

      expect(out.effective_auto_translate).toBe(false);
    });

    it('an explicit room ON is obeyed even when the hook is OFF', () => {
      const out = resolveRoomTranslateSettings(
        { auto_translate: true },
        { auto_translate: false },
      );

      expect(out.effective_auto_translate).toBe(true);
    });

    it.each([
      ['null (an old row written before the default changed)', null],
      ['undefined (no column at all)', undefined],
      ['false (the default a new room is created with)', false],
    ])('a room holding %s inherits the hook', (_label, roomAuto) => {
      /* All three are the same question — "this room asks for nothing" — and
         must answer identically, which is what makes the default flip from
         `null` to `false` safe for rows already in the database.
         null · ไม่มีคอลัมน์ · false = เรื่องเดียวกัน */
      const on = resolveRoomTranslateSettings(
        { auto_translate: roomAuto as boolean | null },
        { auto_translate: true },
      );
      const off = resolveRoomTranslateSettings(
        { auto_translate: roomAuto as boolean | null },
        { auto_translate: false },
      );

      expect(on.auto_translate).toBe(false); // the room's own answer
      expect(on.effective_auto_translate).toBe(true);
      expect(off.effective_auto_translate).toBe(false);
    });

    it('a hook that predates the columns reads as OFF, not as undefined', () => {
      const out = resolveRoomTranslateSettings({}, null);

      expect(out.hook_auto_translate).toBe(false);
      expect(out.effective_auto_translate).toBe(false);
      expect(out.hook_translate_lang).toBeNull();
    });

    it('a room that predates the columns reports every field, none missing', () => {
      const out = resolveRoomTranslateSettings({}, {});

      expect(Object.keys(out).sort()).toEqual(
        [
          'auto_send_translated',
          'auto_translate',
          'detected_source_lang',
          'effective_auto_translate',
          'effective_translate_lang',
          'hook_auto_translate',
          'hook_translate_lang',
          'show_original_text',
          /* [FEAT-20260919-SHOWORIGSRC] added 19/09. This assertion going red is
             the guard doing its job: the dashboard copies the payload field by
             field in three places, so a new field that nobody lists here is one
             nobody wired up either. */
          'show_original_text_source',
          'translate_lang',
        ].sort(),
      );
    });
  });
});
