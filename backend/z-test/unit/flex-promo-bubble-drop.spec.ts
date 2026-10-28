/**
 * [FEAT-20260814-PROMODROP] promo-scoped empty-bubble drop.
 *
 * The template under test is the REAL 5-slot promo carousel an operator built
 * (micro bubbles; each holds `site_rules.promo_N_name/_desc/_deposit_amount`),
 * and every var-map below mirrors the live shop-api `site-rules` shapes measured
 * across 52 production webs on 2026-08-13:
 *   promotions arrays of 0 / 1 / 2 / 3 / 10 entries, and `page.total` values
 *   that DISAGREE with the array length (examplesited: total=801, array=10) — the
 *   rule must never read a count field, only per-slot emptiness.
 *
 * What must hold, clause by clause:
 *   1. webs with fewer promos than slots lose exactly the all-'-' bubbles;
 *   2. a web with zero promos keeps ONE bubble (the floor — never an empty
 *      carousel, LINE requires 1–12);
 *   3. any bubble containing a non-promo tag, a filled promo tag, or no tags
 *      at all is kept — and an untouched carousel is returned BY IDENTITY;
 *   4. non-carousel docs pass through by identity;
 *   5. profile-namespace `promo_*` tags (no numeric slot) never match;
 *   6. the input document is never mutated.
 */
import { dropEmptyPromoBubbles, renderFlexDoc } from '@/modules/webhook';

// ── the operator's real card, reduced to what the rule reads ────────────────
const promoBubble = (n: number) => ({
  type: 'bubble',
  size: 'micro',
  hero: { type: 'image', url: 'https://example.com/x.png', size: 'full' },
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: `{{site_rules.promo_${n}_name}}` },
      { type: 'text', text: `{{site_rules.promo_${n}_desc}}` },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'text', text: 'ฝากขั้นต่ำ' },
          { type: 'text', text: `{{site_rules.promo_${n}_deposit_amount}} ฿` },
        ],
      },
    ],
  },
});
const promoCarousel = () => ({
  type: 'carousel',
  contents: [0, 1, 2, 3, 4].map(promoBubble),
});

/**
 * Var-map exactly as `buildSiteRulesVarMap` emits it for N live promotions:
 * filled slots carry the value, missing slots carry '-' (`FLEX_VAR_EMPTY`).
 * Shapes lifted from examplesitee / examplesitef / examplesitec / examplesited production responses.
 */
const varsForPromos = (
  promos: { name: string; desc: string; dep: string }[],
) => {
  const m: Record<string, string> = {};
  for (let n = 0; n < 5; n++) {
    const p = promos[n];
    m[`site_rules.promo_${n}_name`] = p?.name ?? '-';
    m[`site_rules.promo_${n}_desc`] = p?.desc ?? '-';
    m[`site_rules.promo_${n}_deposit_amount`] = p?.dep ?? '-';
  }
  return m;
};

const LIVE = {
  examplesitee: [{ name: 'ตามลูกค้าไม่ฝาก', desc: 'แต้มฟรี 20', dep: '0' }],
  examplesitef: [
    {
      name: 'แนะนำเพื่อน รับส่วนลด 5 %',
      desc: 'ทุกยอดสุทธิของเพื่อน 5 %',
      dep: '9999',
    },
    { name: 'เงินคืน 5 %', desc: 'กดรับได้ทุกวัน', dep: '99999' },
  ],
  examplesitec: [
    { name: 'โปรโมชั่น แฟชั่น 50%', desc: 'ฝากขั้นต่ำ 50', dep: '50' },
    {
      name: 'โปรโมชั่นอิเล็กทรอนิกส์ 30%',
      desc: 'รับ30%ของยอดซื้อ',
      dep: '50',
    },
    {
      name: 'สมัครสมาชิกใหม่รับส่วนลด 50%',
      desc: 'ฝากขั้นต่ำ 100',
      dep: '100',
    },
  ],
  // examplesited: 10 promos live, page.total = 801 — only 5 template slots exist.
  examplesited: Array.from({ length: 10 }, (_, i) => ({
    name: `โปร ${i + 1}`,
    desc: `รายละเอียด ${i + 1}`,
    dep: String((i + 1) * 10),
  })),
};

describe('dropEmptyPromoBubbles — against live web shapes', () => {
  it.each([
    ['examplesitee (1 promo)', LIVE.examplesitee, 1],
    ['examplesitef (2 promos)', LIVE.examplesitef, 2],
    ['examplesitec (3 promos)', LIVE.examplesitec, 3],
    ['examplesited (10 promos, page.total=801)', LIVE.examplesited, 5],
  ])('%s → keeps %i bubbles', (_label, promos, expected) => {
    const out = dropEmptyPromoBubbles(
      promoCarousel(),
      varsForPromos(promos),
    ) as { contents: unknown[] };
    expect(out.contents).toHaveLength(expected);
  });

  it('zero promos → floor of ONE bubble, never an empty carousel', () => {
    const out = dropEmptyPromoBubbles(promoCarousel(), varsForPromos([])) as {
      contents: unknown[];
    };
    expect(out.contents).toHaveLength(1);
    // the survivor is slot 0, so it renders '-' exactly as every slot does today
    expect(JSON.stringify(out.contents[0])).toContain('promo_0_name');
  });

  it('a full carousel (5 promos) is returned BY IDENTITY — untouched', () => {
    const card = promoCarousel();
    const five = [...LIVE.examplesitec, ...LIVE.examplesitef];
    expect(dropEmptyPromoBubbles(card, varsForPromos(five))).toBe(card);
  });

  it('kept bubbles are the caller’s own objects; input is never mutated', () => {
    const card = promoCarousel();
    const before = JSON.stringify(card);
    const out = dropEmptyPromoBubbles(
      card,
      varsForPromos(LIVE.examplesitee),
    ) as {
      contents: unknown[];
    };
    expect(out.contents[0]).toBe(card.contents[0]);
    expect(JSON.stringify(card)).toBe(before);
  });
});

describe('dropEmptyPromoBubbles — everything else passes through', () => {
  it('non-carousel doc → identity', () => {
    const bubble = promoBubble(0);
    expect(dropEmptyPromoBubbles(bubble, varsForPromos([]))).toBe(bubble);
  });

  it('bubble mixing a promo tag with a non-promo tag is kept', () => {
    const card = {
      type: 'carousel',
      contents: [
        promoBubble(0),
        {
          type: 'bubble',
          size: 'micro',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '{{site_rules.promo_1_name}}' },
              { type: 'text', text: '{{site_rules.dep_min}} บาท' },
            ],
          },
        },
      ],
    };
    const vars = { ...varsForPromos([]), 'site_rules.dep_min': '-' };
    const out = dropEmptyPromoBubbles(card, vars) as { contents: unknown[] };
    // bubble 0: all-empty promo slots → dropped; bubble 1: has dep_min → kept
    expect(out.contents).toHaveLength(1);
    expect(JSON.stringify(out.contents[0])).toContain('dep_min');
  });

  it('static bubble with no tags at all is kept', () => {
    const card = {
      type: 'carousel',
      contents: [
        promoBubble(0),
        {
          type: 'bubble',
          size: 'micro',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'text', text: 'ติดต่อแอดมินได้ตลอด 24 ชม.' }],
          },
        },
      ],
    };
    const out = dropEmptyPromoBubbles(card, varsForPromos([])) as {
      contents: unknown[];
    };
    expect(out.contents).toHaveLength(1);
    expect(JSON.stringify(out.contents[0])).toContain('ติดต่อแอดมิน');
  });

  it('PROFILE promo tags (no numeric slot) never match the rule', () => {
    // the live card "promotion-1" uses exactly these bare profile tags
    const card = {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '{{promo_name}}' },
              { type: 'text', text: '{{promo_desc}}' },
            ],
          },
        },
      ],
    };
    const vars = { promo_name: '-', promo_desc: '-' };
    expect(dropEmptyPromoBubbles(card, vars)).toBe(card);
  });
});

describe('renderFlexDoc integration — drop happens, then substitution', () => {
  it('examplesitee shape end-to-end: 1 bubble out, values substituted, no braces left', () => {
    const doc = { content_json: promoCarousel(), content_tags: [] };
    const out = renderFlexDoc(
      doc,
      varsForPromos(LIVE.examplesitee),
      '',
      null,
    ) as {
      contents: { body: unknown }[];
    };
    expect(out.contents).toHaveLength(1);
    const text = JSON.stringify(out.contents[0]);
    expect(text).toContain('ตามลูกค้าไม่ฝาก');
    expect(text).not.toContain('{{');
  });

  it('zero-promo shape end-to-end: one bubble of dashes — today’s look, once', () => {
    const doc = { content_json: promoCarousel(), content_tags: [] };
    const out = renderFlexDoc(doc, varsForPromos([]), '', null) as {
      contents: unknown[];
    };
    expect(out.contents).toHaveLength(1);
    expect(JSON.stringify(out.contents[0])).toContain('"-"');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [FEAT-20260814-PROMODROP] MIXED-CARD sweep — เจ้าของสั่ง 14/08:
 * "เทสจริง flex msg webhook dyntag ไม้นะ ไม่ใช่แค่ pro flex อื่นด้วย คละ"
 *
 * The unit above proves the rule on promo shapes. This block proves the rule
 * does NOT reach anything else the system actually sends:
 *   · the REAL slip carousels in the DB (flex_error / flex_not_found are
 *     root=carousel) — the slip path never calls renderFlexDoc (it renders via
 *     substituteSlipTags), but that is an architectural accident a refactor
 *     could undo, so the shape is pinned here against the drop DIRECTLY;
 *   · cards mixing dyntag-style content, profile tags and promo slots — only
 *     the all-empty-promo bubble may go, and substitution still runs on what
 *     stays. การ์ดคละ tag ต้องหลุดเฉพาะใบโปรว่างล้วน
 * ──────────────────────────────────────────────────────────────────────────── */

describe('mixed cards — nothing outside promo is ever dropped', () => {
  /** Real slip carousel shape (flex_error / flex_not_found rows, read from the
   *  live DB 2026-08-14): ONE bubble, slip tags in braces, no promo tag. */
  const slipCarousel = () => ({
    type: 'carousel',
    contents: [
      {
        type: 'bubble',
        size: 'deca',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'สลิปไม่ถูกต้อง', color: '#ffffff' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '{sender_name}' },
            { type: 'text', text: '{amount} บาท' },
            { type: 'text', text: '{date_time}' },
          ],
        },
      },
    ],
  });

  it('⭐ a real slip carousel passes through IDENTICAL — no bubble lost', () => {
    const doc = slipCarousel();
    // slip vars are absent from the promo var-map on purpose: worst case for
    // the rule, since every tag in the card resolves to "unknown".
    const out = dropEmptyPromoBubbles(doc, {}) as { contents: unknown[] };
    expect(out.contents).toHaveLength(1);
    expect(out).toEqual(slipCarousel()); // shape untouched, not just the count
  });

  it('⭐ a carousel MIXING slip + promo bubbles drops ONLY the empty promo one', () => {
    const doc = {
      type: 'carousel',
      contents: [
        slipCarousel().contents[0], // slip bubble — must survive
        promoBubble(0), //             promo slot 0 — filled below, survives
        promoBubble(4), //             promo slot 4 — empty ('-'), drops
      ],
    };
    const vars = varsForPromos([{ name: 'ฝาก50รับ100', desc: 'x', dep: '50' }]);
    const out = dropEmptyPromoBubbles(doc, vars) as { contents: unknown[] };
    expect(out.contents).toHaveLength(2);
    expect(JSON.stringify(out.contents[0])).toContain('{sender_name}');
    expect(JSON.stringify(out.contents[1])).toContain('promo_0_name');
  });

  it('⭐ dyntag-style content tags ({content}) keep their bubble even beside empty promo tags', () => {
    // dev-profile (real card) carries {content}; a bubble mixing that with an
    // empty promo slot has a non-promo tag ⇒ the keep-rule must win.
    const doc = {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '{content}' },
              { type: 'text', text: '{{site_rules.promo_4_name}}' },
            ],
          },
        },
      ],
    };
    const out = dropEmptyPromoBubbles(doc, varsForPromos([])) as {
      contents: unknown[];
    };
    expect(out.contents).toHaveLength(1);
  });

  it('profile-tag bubbles (web_code / phone) are never candidates', () => {
    const doc = {
      type: 'carousel',
      contents: [
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '{{profile.web_code}}' },
              { type: 'text', text: '{{profile.phone}}' },
            ],
          },
        },
        promoBubble(4), // empty → drops
      ],
    };
    const out = dropEmptyPromoBubbles(doc, varsForPromos([])) as {
      contents: unknown[];
    };
    expect(out.contents).toHaveLength(1);
    expect(JSON.stringify(out.contents[0])).toContain('profile.web_code');
  });

  it('⭐ end-to-end renderFlexDoc on a MIXED card: drop + substitution both correct', () => {
    const doc = {
      content_json: {
        type: 'carousel',
        contents: [
          promoBubble(0), // filled
          promoBubble(1), // empty → drops
          {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [{ type: 'text', text: '{{profile.web_code}}' }],
            },
          },
        ],
      },
    } as never;
    const vars = {
      ...varsForPromos([{ name: 'ฝาก50รับ100', desc: 'โปรแรก', dep: '50' }]),
      'profile.web_code': 'AB9-REAL',
    };
    const out = JSON.stringify(renderFlexDoc(doc, vars, null, null));

    expect(out).toContain('ฝาก50รับ100'); // promo substituted
    expect(out).toContain('AB9-REAL'); //     profile substituted
    expect(out).not.toContain('promo_1_name'); // empty bubble gone
    expect(out).not.toContain('{{'); //        no braces leak to LINE
    const bubbles = (JSON.parse(out) as { contents: unknown[] }).contents;
    expect(bubbles).toHaveLength(2);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [FEAT-20260814-PROMODROP] FULL-STICK — the seam the webhook actually calls
 *
 * เจ้าของย้ำ (no-bias รอบสอง): "เทสจริง flex msg webhook ... ทั้งไม้ ไม่ใช่แค่ promo"
 * The blocks above call renderFlexDoc directly; the webhook does NOT — it calls
 * `buildFlexProfileReply(flexArgs, flexDeps)` (webhook.service.ts:3716) with the
 * REAL `buildFlexVarMaps` injected. This block drives that exact seam with the
 * real var-map builder AND the real renderer, over a profileData payload shaped
 * like the live custom-tool response. ขับ seam เดียวกับที่ webhook เรียก ของจริงทุกชั้น
 *
 * Also pinned: dyntag (odk_*) lives on the TEXT/prompt path and never enters
 * flex render at all — verified by grep (no odk_ reference in flex-render or
 * the builder), so the drop cannot touch dyntag by construction. A card that
 * carries a literal odk_ string is just static text to this pipeline.
 * ──────────────────────────────────────────────────────────────────────────── */

import {
  buildFlexProfileReply,
  buildFlexVarMaps,
  type FlexReplyDeps,
} from '@/modules/webhook';

describe('full-stick: webhook seam → real var-map → real render → drop', () => {
  /** profileData exactly as getCombinedData hands it to the webhook: a block
   *  per endpoint, site rules found by role/key, shop data with TWO promotions
   *  (out of 10 slots) — the live examplesitee shape reduced to what the map reads. */
  const PROFILE_DATA = {
    CUSTOMER_PROFILE: {
      success: true,
      status: 200,
      is_profile: true,
      data: { profile: { web_code: 'AB9-REAL', phone: '0866666666' } },
    },
    SITE_RULES: {
      success: true,
      status: 200,
      role: 'site_rules',
      data: {
        shop: {
          /* ⚠️ shape ตาม spec จริง: `promotions.promotions[k].<field>`
             (flex-var-spec.ts:897) — ผมเคยเขียน `promotions.data[k]` ตามที่เดา
             แล้วเทสทั้งไม้จับได้ทันทีว่า promo ไม่ fill ทั้งที่ mock ผ่านหมด
             = คุณค่าของการขับ seam จริงแทน mock. path ต้องมาจาก spec เท่านั้น */
          promotions: {
            promotions: [
              { name: 'ฝาก50รับ100', desc: 'โปรแรก', deposit_amount: 50 },
              { name: 'เงินคืน5%', desc: 'แคชแบ็ก', deposit_amount: 0 },
            ],
            page: { total: 2, size: 10, from: 0 },
          },
        },
      },
    },
  };

  /** A mixed card: 4 promo bubbles (2 will fill, 2 empty) + a profile bubble
   *  + a static bubble with a literal odk_ dyntag string (text path's token —
   *  must pass through flex render untouched, neither substituted nor dropped). */
  const MIXED_CARD = {
    _id: 'card-mixed',
    content_json: {
      type: 'carousel',
      contents: [
        promoBubble(0),
        promoBubble(1),
        promoBubble(8), // empty slot (only 2 promos live) → drops
        promoBubble(9), // empty → drops
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'text', text: '{{profile.web_code}}' }],
          },
        },
        {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'text', text: 'odk_p_00001' }],
          },
        },
      ],
    },
    content_tags: [],
    source_roles: ['site_rules'],
  };

  function realDeps(): FlexReplyDeps {
    return {
      flexModel: {
        findOne: () => ({
          lean: () => ({ exec: () => Promise.resolve(MIXED_CARD) }),
        }),
      } as never,
      // ⭐ the REAL var-map assembly the webhook injects — not a stub
      buildDataVars: (doc, profileData, hook) =>
        buildFlexVarMaps(doc, profileData, hook, (_d, k) =>
          // no-base-to-string: k เป็น union — แปลงเฉพาะชนิดที่ stringify ได้จริง
          typeof k === 'string' ? k : typeof k === 'number' ? String(k) : '',
        ),
      // renderFlexDoc omitted on purpose ⇒ the builder falls back to the REAL one
      logger: { warn: () => {}, error: () => {} },
    };
  }

  it('⭐⭐ mixed card through the webhook seam: 2 promo bubbles drop, everything else intact', async () => {
    const out = await buildFlexProfileReply(
      {
        hook: { flex_profile_id: 'card-mixed' },
        profileData: PROFILE_DATA,
        content: null,
      },
      realDeps(),
    );

    const s = JSON.stringify(out);
    const bubbles = (out as { contents: unknown[] }).contents;

    expect(bubbles).toHaveLength(4); // 6 - 2 empty promo
    expect(s).toContain('ฝาก50รับ100'); //     promo slot 0 substituted
    expect(s).toContain('เงินคืน5%'); //    promo slot 1 substituted
    expect(s).not.toContain('promo_8_name'); // empty promo gone
    expect(s).not.toContain('promo_9_name');
    expect(s).toContain('AB9-REAL'); //         profile tag substituted by the real map
    expect(s).toContain('odk_p_00001'); // ⭐ dyntag token passes through UNTOUCHED
    expect(s).not.toContain('{{'); //           no braces leak to LINE
  });

  it('zero promos through the same seam: promo bubbles collapse to the floor, others stay', async () => {
    const noPromo = JSON.parse(
      JSON.stringify(PROFILE_DATA),
    ) as typeof PROFILE_DATA;
    noPromo.SITE_RULES.data.shop.promotions.promotions = [];

    const out = await buildFlexProfileReply(
      {
        hook: { flex_profile_id: 'card-mixed' },
        profileData: noPromo,
        content: null,
      },
      realDeps(),
    );

    const bubbles = (out as { contents: unknown[] }).contents;
    // 4 promo bubbles all empty → all drop (profile + static bubbles keep the
    // carousel non-empty, so no floor bubble is needed); the other two stay.
    expect(bubbles).toHaveLength(2);
    const s = JSON.stringify(out);
    expect(s).toContain('AB9-REAL');
    expect(s).toContain('odk_p_00001');
  });
});
