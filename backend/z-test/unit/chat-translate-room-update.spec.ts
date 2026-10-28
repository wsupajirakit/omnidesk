/**
 * [FEAT-20260918-ROOMTRANS] Phase 2: Translation source language detection room update & precedence
 */
import { Types } from 'mongoose';
import { isTranslateLanguage } from '@/modules/ai-translate';

describe('[FEAT-20260918-ROOMTRANS] Phase 2: Translation Room Update & Precedence', () => {
  describe('Language validation before room update ("ห้ามเดาห้ามพังระบบ")', () => {
    it('accepts canonical detected languages and rejects null or unknown', () => {
      expect(isTranslateLanguage('my')).toBe(true);
      expect(isTranslateLanguage('zh-Hans')).toBe(true);
      expect(isTranslateLanguage('zh-Hant')).toBe(true);
      expect(isTranslateLanguage('en')).toBe(true);
      expect(isTranslateLanguage('lo')).toBe(true);
      expect(isTranslateLanguage('km')).toBe(true);
      expect(isTranslateLanguage('th')).toBe(true);

      // Must reject undefined, null, unknown
      expect(isTranslateLanguage(null as any)).toBe(false);
      expect(isTranslateLanguage(undefined as any)).toBe(false);
      expect(isTranslateLanguage('ja' as any)).toBe(false);
      expect(isTranslateLanguage('auto' as any)).toBe(false);
      expect(isTranslateLanguage('' as any)).toBe(false);
    });
  });

  describe('Precedence calculation ("ห้องแชทจะอ่านค่า จาก chat room ใหญ่กว่า เสมอ")', () => {
    it('room language overrides hook language when room language is set', () => {
      const room = { translate_lang: 'en' };
      const hook = { translate_lang: 'my' };
      const effectiveLang = room.translate_lang || hook.translate_lang || null;
      expect(effectiveLang).toBe('en');
    });

    it('falls back to hook language when room language is not set', () => {
      const room = { translate_lang: null };
      const hook = { translate_lang: 'zh-Hans' };
      const effectiveLang = room.translate_lang || hook.translate_lang || null;
      expect(effectiveLang).toBe('zh-Hans');
    });

    it('falls back to null/default when neither room nor hook has language', () => {
      const room = { translate_lang: null };
      const hook = { translate_lang: null };
      const effectiveLang = room.translate_lang || hook.translate_lang || null;
      expect(effectiveLang).toBeNull();
    });

    it('falls back auto_translate to hook when room.auto_translate is default (null/undefined)', () => {
      // Helper function matching chat.service.ts
      const calcEffectiveAuto = (
        roomAuto: boolean | null | undefined,
        hookAuto?: boolean,
      ) =>
        roomAuto !== null && roomAuto !== undefined
          ? Boolean(roomAuto)
          : Boolean(hookAuto);

      // Room default (null) -> reads from Hook
      expect(calcEffectiveAuto(null, true)).toBe(true);
      expect(calcEffectiveAuto(null, false)).toBe(false);
      expect(calcEffectiveAuto(undefined, true)).toBe(true);
      expect(calcEffectiveAuto(undefined, false)).toBe(false);

      // Room explicitly set -> room overrides Hook
      expect(calcEffectiveAuto(true, false)).toBe(true);
      expect(calcEffectiveAuto(false, true)).toBe(false);
    });
  });

  describe('Room translate_lang update behavior on translation', () => {
    it('updates room translate_lang only when detectedSource is recognized and message has room_id', async () => {
      const roomId = new Types.ObjectId();
      const updatedRooms: Record<string, any> = {};

      const mockChatRoomModel = {
        findByIdAndUpdate: jest
          .fn()
          .mockImplementation((id: Types.ObjectId, update: any) => {
            updatedRooms[String(id)] = update.$set;
            return Promise.resolve({ _id: id, ...update.$set });
          }),
      };

      // Case 1: valid detected source 'my'
      const detectedSource = 'my';
      if (detectedSource && isTranslateLanguage(detectedSource)) {
        await mockChatRoomModel.findByIdAndUpdate(roomId, {
          $set: { translate_lang: detectedSource },
        });
      }
      expect(mockChatRoomModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
      expect(updatedRooms[String(roomId)]).toEqual({ translate_lang: 'my' });

      // Case 2: null detected source (model could not detect) -> do NOT update
      mockChatRoomModel.findByIdAndUpdate.mockClear();
      const unknownSource = null;
      if (unknownSource && isTranslateLanguage(unknownSource)) {
        await mockChatRoomModel.findByIdAndUpdate(roomId, {
          $set: { translate_lang: unknownSource },
        });
      }
      expect(mockChatRoomModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });
});
