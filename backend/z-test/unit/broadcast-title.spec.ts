/**
 * [FEAT-20260823-BCASTTITLE] The line a recipient reads before opening anything.
 * ===========================================================================
 * Owner's rule (23/08): Thai, English and digits only · no leading or trailing
 * space · no special characters · and NO `{{tags}}` at all.
 *
 * Every case here is written from what a person would SEE — a notification is
 * the one place a card cannot be re-read for context, so a broken line there
 * reads as a broken app rather than a missing value.
 */
import {
  BROADCAST_TITLE_DEFAULT,
  BROADCAST_TITLE_MAX,
  buildCardMessage,
  resolveTitle,
} from '@/modules/content';

/* ⚠️ A bubble with no section DROPS — lane B made that a rule after LINE
   rejected such a card outright. A fixture must be a card LINE would accept,
   or it tests the drop path instead of the title. */
const BUBBLE = {
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'text', text: 'เนื้อการ์ด' }],
  },
};

const altOf = (title?: unknown) =>
  (
    buildCardMessage({ type: 'flex', flex_json: BUBBLE }, {}, title)
      .messages[0] as unknown as Record<string, unknown>
  )['altText'];

describe('title — what is allowed', () => {
  it('accepts English, Thai and digits', () => {
    for (const ok of [
      'Promotion 2026',
      'โปรโมชั่น เดือนสิงหา',
      'VIP 100',
      'ข่าว 2026 news',
    ]) {
      expect(resolveTitle(ok)).toEqual({ title: ok });
    }
  });

  it('keeps spaces BETWEEN words', () => {
    expect(resolveTitle('โปร ใหม่ ล่าสุด').title).toBe('โปร ใหม่ ล่าสุด');
  });

  it('reaches the message as altText, replacing core’s hardcoded line', () => {
    /* Core writes `Broadcast message` and its own header says that quirk stays
       on purpose, so ours is applied after core has built the object. */
    expect(altOf('โปรโมชั่นใหม่')).toBe('โปรโมชั่นใหม่');
    expect(altOf('โปรโมชั่นใหม่')).not.toBe('Broadcast message');
  });
});

describe('title — what is refused, and why the admin is told which', () => {
  it('🔴 a tag is refused OUTRIGHT — never substituted', () => {
    /* A notification cannot be re-read for context: a tag resolving to `N/A`
       there reads as a broken app, and one that does not resolve ships literal
       braces to the lock screen. หัวข้อไม่ใช่ที่ของ tag. */
    for (const bad of [
      '{{member.display_name}}',
      'สวัสดี {{member.name}}',
      'ปิด}} เปิด{{',
    ]) {
      expect(resolveTitle(bad)).toEqual({
        title: BROADCAST_TITLE_DEFAULT,
        rejected: 'has-tag',
      });
    }
  });

  it('🔴 says `has-tag`, not `bad-character`, when a tag is the problem', () => {
    /* `{` is also a special character, so order decides which reason the admin
       reads. "You cannot use a tag here" is actionable; "bad character" sends
       them hunting. ต้องบอกเหตุผลที่แก้ตามได้. */
    expect(resolveTitle('{{x}}').rejected).toBe('has-tag');
  });

  it('refuses a leading or trailing space', () => {
    expect(resolveTitle(' โปรโมชั่น').rejected).toBe('edge-space');
    expect(resolveTitle('โปรโมชั่น ').rejected).toBe('edge-space');
    expect(resolveTitle('\tโปร').rejected).toBe('edge-space');
  });

  it('refuses special characters, including emoji', () => {
    for (const bad of ['โปร!', 'sale-2026', '50% off', 'a@b', 'ดี 🎉', 'a_b']) {
      expect(resolveTitle(bad).rejected).toBe('bad-character');
    }
  });

  it('refuses an empty or whitespace-only title', () => {
    expect(resolveTitle('').rejected).toBe('empty');
    expect(resolveTitle('   ').rejected).toBe('empty');
  });

  it('🔴 refuses an over-long title rather than cutting it', () => {
    /* A cut title is a different sentence, and the admin never learns theirs
       was too long. ตัดกลางประโยค = คนละความหมาย. */
    const long = 'ก'.repeat(BROADCAST_TITLE_MAX + 1);
    expect(resolveTitle(long).rejected).toBe('too-long');
    expect(resolveTitle('ก'.repeat(BROADCAST_TITLE_MAX))).toEqual({
      title: 'ก'.repeat(BROADCAST_TITLE_MAX),
    });
  });

  it('refuses a non-string without throwing', () => {
    expect(resolveTitle(42).rejected).toBe('bad-character');
    expect(resolveTitle({}).rejected).toBe('bad-character');
  });
});

describe('title — falling back never costs the campaign', () => {
  it('🔴 an invalid title still sends, with the default line', () => {
    /* Refusing a whole campaign over a notification line would be the wrong
       trade. ผิดกติกา = ใช้ค่าเริ่มต้น ไม่ใช่ไม่ส่ง. */
    expect(altOf('โปร!!!')).toBe(BROADCAST_TITLE_DEFAULT);
    expect(altOf(undefined)).toBe(BROADCAST_TITLE_DEFAULT);
  });

  it('the reason rides back so the admin can be told', () => {
    const r = buildCardMessage(
      { type: 'flex', flex_json: BUBBLE },
      {},
      '{{member.name}}',
    );
    expect(r.titleRejected).toBe('has-tag');
  });

  it('a valid title reports no rejection at all', () => {
    const r = buildCardMessage(
      { type: 'flex', flex_json: BUBBLE },
      {},
      'โปรโมชั่น 2026',
    );
    expect(r).not.toHaveProperty('titleRejected');
  });
});

describe('title — flex only, and the UI must not pretend otherwise', () => {
  it('a text card has no altText — LINE uses the content itself', () => {
    const r = buildCardMessage({ type: 'text', text: 'สวัสดี' }, {}, 'หัวข้อ');
    expect(r.messages[0]).not.toHaveProperty('altText');
  });

  it('an image card has none either', () => {
    const r = buildCardMessage(
      { type: 'image', image_url: 'https://example.com/a.jpg' },
      {},
      'หัวข้อ',
    );
    expect(r.messages[0]).not.toHaveProperty('altText');
  });
});
