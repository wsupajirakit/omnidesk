/**
 * [FEAT-20260829-MENUPBGUIDE] the copyable postback spec.
 *
 * Owner, 29/08: "ก็ไม่ให้พิมพ์เองแต่ให้ copy — fe โหลด single truth ที่ be มีบอก",
 * "be ออกให้จุดเดียว".
 *
 * ── WHAT MAKES THIS WORTH TESTING ───────────────────────────────────────────
 * The rows exist so an operator never TYPES a payload, because every near-miss
 * fails silently — measured against the real parser on 29/08: a missing `v1`, a
 * typo in `open`, an uppercase letter or a space all parse as NOT-OURS, and the
 * customer taps a button that does nothing at all. So the rows must be
 * PARSEABLE BY THE REAL PARSER, not merely present: a guide that hands out a
 * dead string is worse than no guide, since the admin now trusts it.
 *
 * They must also stay DERIVED. A hand-written copy here would drift the day the
 * codec changes and would keep handing out a payload that no longer parses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseMenuOpenPostback,
  parseMenuPostback,
  MENU_POSTBACK_PREFIX,
  MENU_POSTBACK_MAX_BYTES,
} from '@/modules/menu';
import {
  buildMenuPostbackGuidelines,
  FlexMessagesService,
} from '@/modules/content';

const rows = () => buildMenuPostbackGuidelines();

/** The rows that are real payloads (the other two are explanatory). */
const payloadRows = () =>
  rows().filter((r) => r.tag.startsWith(MENU_POSTBACK_PREFIX));

describe('[MENUPBGUIDE] every payload the guide hands out actually parses', () => {
  it('⭐⭐⭐ each sample is accepted by the REAL parser', () => {
    const dead = payloadRows().filter(
      (r) => !parseMenuOpenPostback(r.tag) && !parseMenuPostback(r.tag),
    );
    expect(dead).toEqual([]);
  });

  it('⭐ each EXAMPLE parses too — an admin copies whichever line looks closer', () => {
    const dead = payloadRows()
      .map((r) => (typeof r.example === 'string' ? r.example : ''))
      .filter((e) => e.startsWith(MENU_POSTBACK_PREFIX))
      .filter((e) => !parseMenuOpenPostback(e) && !parseMenuPostback(e));
    expect(dead).toEqual([]);
  });

  it('covers BOTH link kinds — a card may mix them', () => {
    const kinds = payloadRows().map((r) =>
      parseMenuOpenPostback(r.tag) ? 'open' : 'scenario',
    );
    expect(kinds.sort()).toEqual(['open', 'scenario']);
  });

  it('says how to make a button that goes NOWHERE', () => {
    /* "leave it out" is the answer, and an operator hunting for a field to
       blank would otherwise never find one — there is no target column. */
    const none = rows().find((r) => /ไม่ใส่ postback/.test(r.tag));
    expect(none).toBeDefined();
    expect(none?.desc).toMatch(/uri/);
  });

  it('states the LINE byte cap, taken from the codec not retyped', () => {
    const cap = rows().find((r) =>
      r.tag.includes(String(MENU_POSTBACK_MAX_BYTES)),
    );
    expect(cap).toBeDefined();
  });

  it('every row is noPrefix — these are payloads, never {{variables}}', () => {
    expect(rows().every((r) => r.noPrefix === true)).toBe(true);
    expect(rows().some((r) => r.tag.includes('{{'))).toBe(false);
  });

  it('every row carries a description and a source, like any guide row', () => {
    for (const r of rows()) {
      expect(r.desc.trim().length).toBeGreaterThan(0);
      expect(r.source.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('[MENUPBGUIDE] the rows are DERIVED, never hand-typed', () => {
  it('⭐⭐ no payload literal is spelled out in the source file', () => {
    /* The guide must call the codec. A literal here is a second spelling of the
       grammar and drifts the day the codec changes. */
    const src = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src/modules/content/flex-var/menu-postback-guidelines.ts',
      ),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/['"`]menu:v1:/);
    expect(code).toContain('buildMenuOpenPostback(');
    expect(code).toContain('buildMenuPostback(');
  });
});

describe('[MENUPBGUIDE] served from the ONE existing endpoint', () => {
  const svc = () =>
    /* ⚠️ FIVE args — `dictCache` is the 5th. A 3-arg call still let the suite
       pass because a spec is not arity-checked the way a compiled file is, so
       the translate stub was silently landing in `counterModel`'s slot and the
       rows came back from a service wired wrong. Caught by tsc on the probe. */
    new FlexMessagesService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { translate: (_d: unknown, k: unknown) => String(k) } as never,
    );

  const guide = (flexType: string): Record<string, unknown>[] =>
    (svc().getFlexVariableGuidelines({ flex_type: flexType }).data[
      'rows'
    ] as Record<string, unknown>[]) ?? [];

  it('⭐⭐⭐ a menu card gets the postback rows', () => {
    const tags = guide('menu').map((r) => String(r['tag']));
    expect(tags.some((t) => t.startsWith(MENU_POSTBACK_PREFIX))).toBe(true);
  });

  it('⭐⭐⭐ NO other card type gets them — nothing else changes', () => {
    for (const t of ['slip', 'normal', 'customerhelper', 'profile', 'custom']) {
      const tags = guide(t).map((r) => String(r['tag']));
      expect(tags.some((x) => x.startsWith(MENU_POSTBACK_PREFIX))).toBe(false);
    }
  });

  it('a menu card still gets the ordinary context rows — the guide is additive', () => {
    expect(guide('menu').length).toBeGreaterThan(payloadRows().length);
  });
});
