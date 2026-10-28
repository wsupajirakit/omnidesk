/**
 * [FEAT-20260831-OPENFLEXTAG] `menu:v1:open:flex:<tag>` opens ANY flex card.
 * ===========================================================================
 * Owner 31/08: a menu button should be able to open a flex card by the same
 * minted tag that already names it in an AI prompt —
 * `[[[flex_m00023]]]` ⇒ `menu:v1:open:flex:flex_m00023`.
 *
 * 🔴 THE REQUIREMENT THAT SHAPES EVERY CASE HERE: ห้ามกระทบส่วนอื่นเด็ดขาด. So
 * this file spends most of its cases on what must NOT change:
 *   · the two existing payload forms answer exactly as before, INCLUDING for the
 *     new string — proven by running them, which is also how the new form was
 *     shown to be unclaimed before a line of it was written
 *   · a card belonging to another OA is still refused (the group check is the
 *     rule that stands in for the type pin this door drops)
 *   · every OTHER door still pins `flex_type` in its query
 *   · the operator's own buttons are left exactly as drawn
 */
import { createMenuEngine } from '@/modules/menu';
import {
  buildMenuOpenFlexPostback,
  parseMenuOpenFlexPostback,
  parseMenuOpenPostback,
  parseMenuPostback,
} from '@/modules/menu/menu-postback.util';

const PAYLOAD = 'menu:v1:open:flex:flex_m00023';

describe('[OPENFLEXTAG] the codec', () => {
  it('⭐⭐⭐ mints the shape the owner asked for', () => {
    expect(buildMenuOpenFlexPostback('flex_m00023')).toBe(PAYLOAD);
  });

  it('⭐⭐⭐ reads its own payload back', () => {
    expect(parseMenuOpenFlexPostback(PAYLOAD)).toEqual({ tag: 'flex_m00023' });
  });

  it('⭐⭐⭐ every minted family is addressable, not just menu cards', () => {
    for (const tag of [
      'flex_m00023',
      'flex_pc00003',
      'menu_main_00010',
      'menu_sub_00013',
    ]) {
      expect(parseMenuOpenFlexPostback(buildMenuOpenFlexPostback(tag))).toEqual(
        {
          tag,
        },
      );
    }
  });

  it('⭐⭐⭐ THE ZERO-IMPACT PROOF — the other two forms are blind to it', () => {
    /* This is the same evidence that justified writing the form at all: the
       string means NOTHING today, so no payload in the wild changes meaning. */
    expect(parseMenuOpenPostback(PAYLOAD)).toBeNull();
    expect(parseMenuPostback(PAYLOAD)).toBeNull();
  });

  it('⭐⭐⭐ and the new reader is blind to THEIRS', () => {
    expect(parseMenuOpenFlexPostback('menu:v1:open:sub-register')).toBeNull();
    expect(parseMenuOpenFlexPostback('menu:v1:second:sub-a')).toBeNull();
    expect(parseMenuOpenFlexPostback('pay:retry:1')).toBeNull();
    expect(parseMenuOpenFlexPostback('menu:open')).toBeNull();
  });

  it('⭐⭐ the existing forms still answer exactly as they always did', () => {
    expect(parseMenuOpenPostback('menu:v1:open:sub-register')).toEqual({
      slug: 'sub-register',
    });
    expect(parseMenuPostback('menu:v1:second:sub-a')).toEqual({
      scenarioKey: 'second',
      itemId: 'sub-a',
    });
  });

  it('⭐⭐ free text is not a tag — the door takes minted shapes only', () => {
    for (const bad of ['sub-register', 'flex_m', 'FLEX_M00023', '00023', '']) {
      expect(() => buildMenuOpenFlexPostback(bad)).toThrow();
      expect(parseMenuOpenFlexPostback(`menu:v1:open:flex:${bad}`)).toBeNull();
    }
  });
});

/* ── the door, driven through the real engine ───────────────────────────── */

const CARD = {
  flex_type: 'custom',
  flex_tag: 'flex_m00023',
  name: 'promo card',
  group_ids: ['g1'],
  content_json: {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: { type: 'uri', label: 'go', uri: 'https://example.invalid' },
        },
      ],
    },
  },
};

function harness(rows: Record<string, unknown>[] = [CARD]) {
  const queries: Record<string, unknown>[] = [];
  const sent: unknown[][] = [];
  const refusals: string[] = [];
  const engine = createMenuEngine({
    coreSend: (_t: unknown, messages: unknown[]) => {
      sent.push(messages);
      return Promise.resolve({ status: 200 });
    },
    cards: {
      find: (q: Record<string, unknown>) => {
        queries.push(q);
        const hit =
          rows.find(
            (r) =>
              (!q['tag'] || r['flex_tag'] === q['tag']) &&
              (!q['slug'] || r['flex_slug'] === q['slug']) &&
              (!q['flexType'] || r['flex_type'] === q['flexType']),
          ) ?? null;
        return Promise.resolve(hit);
      },
    },
    onCardRefused: (reason: string, detail: string) =>
      refusals.push(`${reason} ${detail}`),
  });
  const ctx = (group = 'g1') => ({
    hook: { _id: 'h1', group },
    lineUserId: 'U1',
    member: null,
    siteRules: null,
    silence: { silenced: false },
  });
  return { engine, queries, sent, refusals, ctx };
}

describe('[OPENFLEXTAG] the door', () => {
  it('⭐⭐⭐ a press sends the card the tag names', async () => {
    const h = harness();
    const out = await h.engine.handlePostback({
      data: PAYLOAD,
      replyToken: 'rt',
      context: h.ctx() as never,
    });
    expect(out).toMatchObject({ handled: true, action: 'sent' });
    expect(h.sent).toHaveLength(1);
    const msg = h.sent[0]![0] as Record<string, unknown>;
    expect(msg['type']).toBe('flex');
    /* the CARD's name is the alt-text, never the tag */
    expect(msg['altText']).toBe('promo card');
  });

  it('⭐⭐⭐ the query does NOT pin a type — that is what makes it work', async () => {
    const h = harness();
    await h.engine.handlePostback({
      data: PAYLOAD,
      replyToken: 'rt',
      context: h.ctx() as never,
    });
    expect(h.queries[0]).toMatchObject({ tag: 'flex_m00023' });
    expect(h.queries[0]!['flexType']).toBeUndefined();
  });

  it('⭐⭐⭐ another OA cannot reach the card — the group check is untouched', async () => {
    const h = harness();
    await h.engine.handlePostback({
      data: PAYLOAD,
      replyToken: 'rt',
      context: h.ctx('somebody-else') as never,
    });
    expect(h.refusals.join(' ')).toContain('other-group');
    /* it falls back to the fixed menu rather than sending the card */
    const msg = h.sent[0]?.[0] as Record<string, unknown> | undefined;
    expect(msg?.['altText']).not.toBe('promo card');
  });

  it('⭐⭐⭐ an unknown tag draws nobody else’s card', async () => {
    const h = harness();
    await h.engine.handlePostback({
      data: 'menu:v1:open:flex:flex_m99999',
      replyToken: 'rt',
      context: h.ctx() as never,
    });
    expect(h.refusals.join(' ')).toContain('not-found');
  });

  it('⭐⭐ the operator’s own button survives — nothing is minted over it', async () => {
    const h = harness();
    await h.engine.handlePostback({
      data: PAYLOAD,
      replyToken: 'rt',
      context: h.ctx() as never,
    });
    const drawn = JSON.stringify(h.sent[0]![0]);
    expect(drawn).toContain('https://example.invalid');
    expect(drawn).not.toContain('menu:v1:');
  });

  it('⭐⭐⭐ THE SLUG DOOR STILL PINS ITS TYPE — only the new one omits it', async () => {
    const h = harness();
    await h.engine.handlePostback({
      data: 'menu:v1:open:sub-register',
      replyToken: 'rt',
      context: h.ctx() as never,
    });
    expect(h.queries[0]!['flexType']).toBeDefined();
    expect(h.queries[0]).toMatchObject({ slug: 'sub-register' });
  });

  it('⭐⭐ a foreign payload is still NOT ours', async () => {
    const h = harness();
    const out = await h.engine.handlePostback({
      data: 'pay:retry:1',
      replyToken: 'rt',
      context: h.ctx() as never,
    });
    expect(out).toEqual({ handled: false });
    expect(h.sent).toHaveLength(0);
    expect(h.queries).toHaveLength(0);
  });

  it('⭐⭐ a silenced room sends nothing at all', async () => {
    const h = harness();
    const ctx = { ...h.ctx(), silence: { silenced: true } };
    const out = await h.engine.handlePostback({
      data: PAYLOAD,
      replyToken: 'rt',
      context: ctx as never,
    });
    expect(out).toMatchObject({ action: 'silent' });
    expect(h.sent).toHaveLength(0);
  });
});
