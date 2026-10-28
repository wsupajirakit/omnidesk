/**
 * [FIX-20260918-LANGSPLIT] The target must survive the detected source.
 * =============================================================================
 * Two different answers used to share one field, `translate_lang`:
 *   · the TARGET the operator picked in the room modal, and
 *   · the SOURCE the vendor reported for the customer's last message.
 * The second overwrote the first, so a room set to `en` became `my` the moment a
 * Burmese message was translated in it — and the next save sent that back.
 *
 * This file is a DRIFT GUARD in the shape this repo already uses
 * (`noticeCardGate.value.test.ts`): it reads the component source and asserts
 * the three places that copy a room field by field all NAME the new field.
 * A field-by-field copier drops anything it does not name, silently, with no
 * type error and no failing render test — which is exactly how this class of bug
 * has landed here twice before. ลอกทีละ field = ลืมตัวไหน ตัวนั้นหายเงียบ
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../components/chat/ChatRoomView.tsx'),
  'utf8',
);

describe('[FIX-20260918-LANGSPLIT] detected source is a field of its own', () => {
  it('the translation result writes detected_source_lang, never translate_lang', () => {
    // The patch handler reacts to `translations[0].from` — the detected source.
    const block = SRC.slice(
      SRC.indexOf('const detectedFrom = patch.translations[0].from'),
    ).slice(0, 400);

    expect(block).toContain('detected_source_lang: detectedFrom');
    // 🔴 the bug, spelled out so it cannot come back unnoticed.
    expect(block).not.toContain('translate_lang: detectedFrom');
  });

  it('every field-by-field room copier names detected_source_lang', () => {
    // Each of these copies the room one key at a time; a key left out is lost.
    const copiers = [
      'detected_source_lang: res.data.detected_source_lang ?? null,', // PATCH response
      'res.room.detected_source_lang ?? prev.detected_source_lang', // page reconcile
      'detected_source_lang: nextDetectedSource,', // reconcile result
    ];

    for (const line of copiers) {
      expect(SRC).toContain(line);
    }
    // The PATCH and GET handlers are two separate copies of the same block.
    expect(
      SRC.split('detected_source_lang: res.data.detected_source_lang ?? null,')
        .length - 1,
    ).toBe(2);
  });

  it('the reconcile bail-out compares detected_source_lang too', () => {
    // Without this the room would re-render on every poll, or worse, keep a
    // stale value while claiming nothing changed.
    expect(SRC).toContain('prev.detected_source_lang === nextDetectedSource');
  });
});
