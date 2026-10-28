/**
 * [FEAT-20260829-MENUSTORED] Cross-flow isolation: the menu grammar must not
 * collide with any tag another feature already owns, in EITHER direction.
 *
 * The menu family is `[[[menu-primary-*]]]` / `[[[menu-second-*]]]`, and the
 * marker syntax `[[[...]]]` is shared with customer-helper and the dynamic tags.
 * That shared syntax is exactly where a collision would hide: a menu parser that
 * is too greedy silently swallows another feature's marker, and the customer
 * gets a menu instead of the answer they asked for. Neither direction shows up
 * in either feature's own suite, because each only tests its own inputs.
 *
 * Real markers below are read from the codebase, not invented.
 */
import {
  parseMenuTag,
  findMenuTag,
  hasMenuTag,
  stripMenuTags,
} from '@/modules/menu';

/**
 * Markers owned by OTHER features. Every `[[[...]]]` entry here was READ OUT OF
 * `src/` on 29/08/2026 (`grep -rhoE '\[\[\[[a-z0-9_-]+\]\]\]'`), with its
 * live occurrence count, rather than imagined — a made-up marker that happens to
 * be safe proves nothing about the ones that actually ship.
 */
const FOREIGN_MARKERS = [
  '[[[assist]]]', // 30 uses
  '[[[customer-helper]]]', // 21
  '[[[history]]]', // 10
  '[[[custom_content_1]]]', // 8
  '[[[flex_profile]]]', // 7
  '[[[tag]]]', // 3
  '[[[img_promo]]]', // 3
  '[[[name]]]', // 2
  '[[[flex_m00001]]]', // 2 — starts with 'm', the nearest miss to 'menu'
  '[[[flex_pc00001]]]', // 1
  '[[[customer-register]]]', // 1
  // near-misses on our own grammar: none of these is a menu tag
  '[[[menu]]]', // no level
  '[[[menuprimary]]]', // missing separator
  '[[[submenu-primary]]]', // different prefix
  '[[[menu-third]]]', // level we do not own
  '{{profile.name}}',
  '{{site_rule.x}}',
];

/** Ours, for contrast. */
const OURS = [
  '[[[menu-primary]]]',
  '[[[menu-primary-a]]]',
  '[[[menu-second]]]',
  '[[[menu-second-f]]]',
];

describe('[MENUCROSS] the menu never claims another feature tag', () => {
  it.each(FOREIGN_MARKERS)('does not parse %s as a menu tap', (marker) => {
    expect(parseMenuTag(marker)).toBeNull();
  });

  it.each(FOREIGN_MARKERS)('does not detect %s anywhere in text', (marker) => {
    expect(findMenuTag(`ข้อความ ${marker} ต่อท้าย`)).toBeNull();
    expect(hasMenuTag(`ข้อความ ${marker} ต่อท้าย`)).toBe(false);
  });

  it('leaves a foreign marker untouched when stripping menu tags', () => {
    const text = 'ก่อน [[[customer-helper]]] กลาง [[[menu-primary]]] หลัง';
    const out = stripMenuTags(text);
    expect(out).toContain('[[[customer-helper]]]');
    expect(out).not.toContain('[[[menu-primary]]]');
  });

  it('strips ONLY the menu tag when both families sit side by side', () => {
    const out = stripMenuTags('[[[menu-primary]]][[[customer-helper]]]');
    expect(out).toBe('[[[customer-helper]]]');
  });
});

describe('[MENUCROSS] the menu still claims its own', () => {
  it.each(OURS)('parses %s', (tag) => {
    expect(parseMenuTag(tag)).not.toBeNull();
    expect(findMenuTag(`นำหน้า ${tag}`)).not.toBeNull();
  });

  it('a menu tag beside a helper marker is still found', () => {
    expect(findMenuTag('[[[customer-helper]]] [[[menu-second-b]]]')).toEqual({
      level: 'second',
      variant: 'b',
    });
  });
});

describe('[MENUCROSS] a tap must be the WHOLE message (never steals prose)', () => {
  it('does not fire on a menu tag buried in a sentence', () => {
    // findMenuTag (outbound detector) sees it; parseMenuTag (the door) must not.
    const text = 'ลูกค้าพิมพ์ว่า [[[menu-primary]]] มาในประโยค';
    expect(findMenuTag(text)).not.toBeNull();
    expect(parseMenuTag(text)).toBeNull();
  });

  it('does not fire on ordinary customer prose', () => {
    for (const s of ['สวัสดีครับ', 'ขอดูเมนู', 'menu', 'เมนูหลัก', '']) {
      expect(parseMenuTag(s)).toBeNull();
      expect(hasMenuTag(s)).toBe(false);
    }
  });
});
