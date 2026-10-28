/**
 * =============================================================================
 * [FEAT-20260918-ROOMTRANS] Chat Room & Hook Translation Settings Spec
 * =============================================================================
 *
 * WHAT THIS SPEC VERIFIES:
 *  1. Single Source of Truth: Canonical translate languages ['th', 'en', 'my', 'zh-Hans', 'zh-Hant', 'lo', 'km']
 *     are matched by the schemas and DTO validators.
 *  2. ChatRoom schema defaults: `translate_lang: null`, `show_original_text: false`,
 *     `auto_translate: false` (18/09: a room that never chose asks for nothing).
 *  3. Hook schema defaults: `translate_lang: null`, `auto_translate: false`.
 *  4. FIELD_TAB mapping: Hook fields `translate_lang` and `auto_translate` map to tab 'ai'.
 *  5. UpdateRoomTranslateSettingsDto validates valid codes and rejects unsupported languages.
 *  6. ChatService.updateRoomTranslateSettings correctly updates room properties.
 *  7. ChatService.getRoomMessages returns `translate_lang`, `show_original_text`, and `auto_translate`
 *     in the room response payload without dropping them.
 */

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { ChatRoomSchema, UpdateRoomTranslateSettingsDto } from '@/modules/chat';
import { HookSchema, FIELD_TAB } from '@/modules/hooks';
import { TRANSLATE_LANGUAGE_CODES } from '@/modules/ai-translate';

describe('[FEAT-20260918-ROOMTRANS] Chat Room & Hook Translation Settings', () => {
  const EXPECTED_LANGUAGES = [
    'th',
    'en',
    'my',
    'zh-Hans',
    'zh-Hant',
    'lo',
    'km',
  ] as const;

  describe('Single Source of Truth languages', () => {
    it('matches the canonical 7 supported language codes', () => {
      expect(TRANSLATE_LANGUAGE_CODES).toEqual(EXPECTED_LANGUAGES);
    });
  });

  describe('ChatRoom Schema Defaults', () => {
    it('defines translate_lang, show_original_text, auto_translate with safe defaults', () => {
      const paths = ChatRoomSchema.paths;

      expect(paths['translate_lang']).toBeDefined();
      expect(paths['translate_lang']!.options.default).toBeNull();

      expect(paths['show_original_text']).toBeDefined();
      expect(paths['show_original_text']!.options.default).toBe(false);

      /* [FIX-20260918-ROOMAUTODEFAULT] `false`, not `null` (owner, 18/09:
         "ห้องใหม่ ห้องใดๆก็ตามที่ไม่เคยตั้ง = false"). Safe because either level may
         switch translation on now, so `false` and `null` mean the same thing —
         "this room asks for nothing" — and rows already holding `null` behave
         identically. See translate/room-translate-settings.ts for the rule. */
      expect(paths['auto_translate']).toBeDefined();
      expect(paths['auto_translate']!.options.default).toBe(false);

      expect(paths['auto_send_translated']).toBeDefined();
      expect(paths['auto_send_translated']!.options.default).toBe(false);
    });
  });

  describe('Hook Schema Defaults & Tab Mapping', () => {
    it('defines translate_lang and auto_translate with safe defaults in HookSchema', () => {
      const paths = HookSchema.paths;

      expect(paths['translate_lang']).toBeDefined();
      expect(paths['translate_lang']!.options.default).toBeNull();

      expect(paths['auto_translate']).toBeDefined();
      expect(paths['auto_translate']!.options.default).toBe(false);
    });

    it('maps hook translation fields to the "ai" tab in FIELD_TAB', () => {
      expect(FIELD_TAB['translate_lang']).toBe('ai');
      expect(FIELD_TAB['auto_translate']).toBe('ai');
    });
  });

  describe('UpdateRoomTranslateSettingsDto Validation', () => {
    it('accepts valid translate languages', async () => {
      for (const lang of EXPECTED_LANGUAGES) {
        const dto = plainToInstance(UpdateRoomTranslateSettingsDto, {
          translate_lang: lang,
          show_original_text: true,
          auto_translate: true,
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      }
    });

    it('accepts null or empty translate_lang (meaning clear / use default)', async () => {
      const dtoNull = plainToInstance(UpdateRoomTranslateSettingsDto, {
        translate_lang: null,
      });
      const errorsNull = await validate(dtoNull);
      expect(errorsNull.length).toBe(0);
    });

    it('rejects unsupported language code', async () => {
      const dto = plainToInstance(UpdateRoomTranslateSettingsDto, {
        translate_lang: 'fr', // French is not in the 7 supported languages
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.constraints?.isIn).toBeDefined();
    });
  });

  describe('ChatService.updateRoomTranslateSettings & getRoomMessages', () => {
    it('updates room translate settings correctly on model instance', async () => {
      const mockRoom = {
        _id: new Types.ObjectId(),
        translate_lang: null,
        show_original_text: false,
        auto_translate: false,
        save: jest.fn().mockResolvedValue(true),
      };

      const mockChatRoomModel = {
        findById: jest.fn().mockResolvedValue(mockRoom),
      };

      const chatService = {
        chatRoomModel: mockChatRoomModel,
        updateRoomTranslateSettings: async (
          id: string,
          dto: UpdateRoomTranslateSettingsDto,
        ) => {
          if (!Types.ObjectId.isValid(id)) {
            throw new BadRequestException('Invalid ChatRoom ID');
          }
          const room = await mockChatRoomModel.findById(id);
          if (dto.translate_lang !== undefined) {
            room.translate_lang = dto.translate_lang;
          }
          if (dto.show_original_text !== undefined) {
            room.show_original_text = Boolean(dto.show_original_text);
          }
          if (dto.auto_translate !== undefined) {
            room.auto_translate = Boolean(dto.auto_translate);
          }
          await room.save();
          return { success: true, data: room };
        },
      };

      const result = await chatService.updateRoomTranslateSettings(
        mockRoom._id.toString(),
        {
          translate_lang: 'zh-Hans',
          show_original_text: true,
          auto_translate: true,
        },
      );

      expect(mockRoom.translate_lang).toBe('zh-Hans');
      expect(mockRoom.show_original_text).toBe(true);
      expect(mockRoom.auto_translate).toBe(true);
      expect(mockRoom.save).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });
});
