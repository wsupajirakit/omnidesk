/**
 * [FEAT-20260824-BCASTTRANSCRIPT] The purple "Multicast" divider.
 *
 * เจ้าของ 24/08: *"fe ใช้ divider สีม่วง 'Multicast' จาก job ชื่อ xxxxx"* ·
 * *"ห้ามกระทบกับข้อความประเภทอื่น"*.
 *
 * 🔴 WHY A TEST FOR A COLOUR. `DIVIDER_STYLES` is a plain map with no type that
 * forces a variant to exist, so the BE can write `variant: 'multicast'` and the
 * FE can render it grey forever with nothing failing anywhere. The two halves
 * are only connected by this string. BE เขียน variant ได้ · FE ไม่รู้จักก็เทาเฉย ๆ ไม่ error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  join(__dirname, '..', 'components/chat/ChatRoomView.tsx'),
  'utf8',
);

describe('divider variant `multicast`', () => {
  it('🔴 has a style entry — without one it renders grey and unnoticed', () => {
    expect(SOURCE).toMatch(/^\s*multicast:$/m);
  });

  it('🔴 is PURPLE, and is the only DIVIDER that is', () => {
    /* The colour is the signal that this line was not part of the conversation.
       If another divider variant ever takes purple too, that signal is gone.
       สีคือสัญญาณ ⇒ ห้ามมี divider ตัวอื่นใช้ม่วงซ้ำ.

       ⚠️ SCOPED TO THE `DIVIDER_STYLES` BLOCK, and the first version of this
       test was not — it scanned the whole file and failed on an unrelated
       purple badge and a purple avatar elsewhere in the component. A guard that
       fires on code it does not govern gets deleted by the next person.
       ตรวจเฉพาะบล็อกที่ตัวเองคุม ไม่งั้นเดี๋ยวก็โดนลบทิ้ง. */
    const block = SOURCE.slice(
      SOURCE.indexOf('const DIVIDER_STYLES'),
      SOURCE.indexOf('const DIVIDER_ICONS'),
    );
    expect(block).toContain('DIVIDER_STYLES');
    const purpleLines = block.split('\n').filter(l => l.includes('purple-'));
    expect(purpleLines).toHaveLength(1);
    expect(purpleLines[0]).toContain('bg-purple-50');
    /* and it belongs to `multicast`, not to some other variant */
    const idx = block.indexOf('multicast:');
    expect(idx).toBeGreaterThan(-1);
    expect(block.indexOf('purple-')).toBeGreaterThan(idx);
  });

  it('🔴 has an icon entry AND the icon is imported', () => {
    /* An icon named but not imported renders as nothing, and nothing fails. */
    expect(SOURCE).toMatch(/multicast: <Megaphone size=\{12\} \/>/);
    expect(SOURCE).toMatch(/Megaphone,/);
  });

  it('🔴 no other variant was touched', () => {
    /* เจ้าของ: "ไม่แตะ variant อื่น". These are the ones that existed before. */
    for (const kept of [
      'accept',
      'close',
      'assign',
      'bot',
      'auto_ticket',
      'suppressed_reply',
      'direct_ticket',
      'note',
      'claim',
      'reopen_by_admin',
    ]) {
      expect(SOURCE).toContain(`${kept}:`);
    }
  });
});
