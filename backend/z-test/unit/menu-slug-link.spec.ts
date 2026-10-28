/* eslint-disable @typescript-eslint/require-await */
/**
 * [FEAT-20260829-MENUSLUGLINK] a card names its own destination.
 *
 * ── THE OWNER'S MODEL (29/08) ───────────────────────────────────────────────
 * Card main `a` has a button that opens sub `sub-a` — or `sub-x` tomorrow —
 * and the operator changes that by editing ONE button in the FE. No deploy, no
 * scenario file, no code. A button that should go NOWHERE simply carries no
 * such payload (a plain `uri` link): there is no target field to leave empty,
 * because a link that goes nowhere is the absence of a link, not a null one.
 *
 * ── WHY A SECOND PAYLOAD FORM RATHER THAN A COLUMN ──────────────────────────
 * One card has MANY buttons; a `target` column holds one value, so it could
 * never express "this button goes to sub-a, that one goes to sub-x, that one is
 * a link". The destination belongs to the BUTTON, and a flex button already has
 * a place for it — its own action. Verified before building: the string
 * `menu:v1:open:sub-a` parsed as NOT-OURS (null) beforehand, so the new form is
 * purely additive and cannot change what any existing payload means.
 */
import {
  buildMenuOpenPostback,
  parseMenuOpenPostback,
  parseMenuPostback,
  buildMenuPostback,
  mintButtons,
  MenuEngineService,
  FixedFlexRenderer,
  StoredCardRenderer,
  MENU_POSTBACK_MAX_BYTES,
  type MenuContext,
  type MenuDefinition,
  type StoredMenuCard,
} from '@/modules/menu';

const GROUP = 'g1';
const ctx = (over: Record<string, unknown> = {}): MenuContext => ({
  hook: { group: GROUP },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false, by: null },
  ...over,
});

describe('[SLUGLINK] the codec', () => {
  it('round-trips a slug', () => {
    expect(parseMenuOpenPostback(buildMenuOpenPostback('sub-a'))).toEqual({
      slug: 'sub-a',
    });
  });

  it('⭐ the two forms never claim each other', () => {
    const link = buildMenuOpenPostback('sub-a');
    const scenario = buildMenuPostback('primary', 'dep');
    expect(parseMenuPostback(link)).toBeNull();
    expect(parseMenuOpenPostback(scenario)).toBeNull();
  });

  it('a foreign payload is not ours in either form', () => {
    for (const d of ['pay:1:2', 'hoc:x', 'menu:open', 'menu:v1:', '', null]) {
      expect(parseMenuOpenPostback(d)).toBeNull();
      expect(parseMenuPostback(d)).toBeNull();
    }
  });

  it('refuses a slug with illegal characters at BUILD time, not at the customer', () => {
    expect(() => buildMenuOpenPostback('sub a')).toThrow();
    expect(() => buildMenuOpenPostback('SUB')).toThrow();
    expect(() => buildMenuOpenPostback('')).toThrow();
  });

  it('the 300-byte cap applies to this form too (one shared enforcer)', () => {
    expect(() =>
      buildMenuOpenPostback('a'.repeat(MENU_POSTBACK_MAX_BYTES)),
    ).toThrow(/exceeds/);
  });

  /* Found by a mutation that stayed GREEN: deleting the parser's charset check
     changed nothing in the suite, which meant an unvalidated slug could reach a
     DB query straight from a customer-controlled payload. The build side was
     covered; the PARSE side is the one an attacker touches. */
  it('⭐ REJECTS a malformed slug on the way IN, not just on the way out', () => {
    for (const bad of [
      'menu:v1:open:sub a',
      'menu:v1:open:SUB',
      'menu:v1:open:',
      'menu:v1:open:a/b',
      'menu:v1:open:{"$ne":null}',
      'menu:v1:open:../etc',
    ]) {
      expect(parseMenuOpenPostback(bad)).toBeNull();
    }
  });

  it('accepts the slug shapes the FE actually produces', () => {
    for (const s of ['1234', 'menu-seed-primary-a', 'sub_x', 'a']) {
      expect(parseMenuOpenPostback(buildMenuOpenPostback(s))).toEqual({
        slug: s,
      });
    }
  });
});

describe('[SLUGLINK] ⭐⭐ the operator button survives minting', () => {
  const def = (): MenuDefinition => ({
    key: 'primary',
    level: 'primary',
    variant: null,
    enabled: true,
    title: 't',
    items: [
      {
        id: 'dep',
        label: 'ฝาก',
        action: { type: 'result', result: { kind: 'text', text: 'x' } },
      },
    ],
  });

  const actionsOf = (doc: unknown): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      if (o['action']) out.push(o['action'] as Record<string, unknown>);
      Object.values(o).forEach(walk);
    };
    walk(doc);
    return out;
  };

  it('a slug-link the operator wrote is NOT overwritten', () => {
    const doc = {
      type: 'bubble',
      body: {
        type: 'box',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'ไปย่อย',
              data: buildMenuOpenPostback('sub-x'),
            },
          },
        ],
      },
    };
    const acts = actionsOf(mintButtons(doc, def()));
    expect(parseMenuOpenPostback(acts[0]!['data'])).toEqual({ slug: 'sub-x' });
  });

  it('a slug-link does not consume an item — later buttons still bind in order', () => {
    const doc = {
      type: 'bubble',
      body: {
        type: 'box',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'ไปย่อย',
              data: buildMenuOpenPostback('sub-x'),
            },
          },
          {
            type: 'button',
            action: { type: 'postback', label: 'ฝาก', data: 'anything' },
          },
        ],
      },
    };
    const acts = actionsOf(mintButtons(doc, def()));
    expect(parseMenuOpenPostback(acts[0]!['data'])).toEqual({ slug: 'sub-x' });
    expect(parseMenuPostback(acts[1]!['data'])?.itemId).toBe('dep');
  });

  it('a plain link button stays a link — "no destination" needs no field', () => {
    const doc = {
      type: 'bubble',
      body: {
        type: 'box',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: 'ฝาก', data: 'x' },
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'เว็บ', uri: 'https://example.com' },
          },
        ],
      },
    };
    const acts = actionsOf(mintButtons(doc, def()));
    expect(acts[1]).toEqual({
      type: 'uri',
      label: 'เว็บ',
      uri: 'https://example.com',
    });
  });
});

describe('[SLUGLINK] the engine door', () => {
  const card = (slug: string): StoredMenuCard => ({
    flex_type: 'menu',
    flex_slug: slug,
    group_ids: [GROUP],
    content_json: {
      type: 'bubble',
      body: { type: 'box', contents: [{ type: 'text', text: `CARD ${slug}` }] },
    },
  });

  const engineWith = (
    shelf: StoredMenuCard[],
    over: Record<string, unknown> = {},
  ) => {
    const send = jest.fn().mockResolvedValue({});
    const asked: (string | undefined)[] = [];
    const fixed = new FixedFlexRenderer();
    const engine = new MenuEngineService({
      sources: [{ get: () => null }],
      renderer: fixed,
      renderers: {
        fixed,
        stored: new StoredCardRenderer({
          source: {
            find: async (q) => {
              asked.push(q.slug);
              return shelf.find((c) => c.flex_slug === q.slug) ?? null;
            },
          },
          fallback: fixed,
        }),
      },
      coreSend: send,
      ...over,
    });
    return { engine, send, asked };
  };

  const press = (engine: MenuEngineService, slug: string, context = ctx()) =>
    engine.handlePostback({
      data: buildMenuOpenPostback(slug),
      replyToken: 'rt',
      context,
    });

  it('⭐ opens the card the slug names — no scenario involved', async () => {
    const { engine, send, asked } = engineWith([card('sub-a'), card('sub-x')]);
    const out = await press(engine, 'sub-x');
    expect(out).toEqual({ handled: true, action: 'sent' });
    expect(asked).toEqual(['sub-x']);
    expect(JSON.stringify(send.mock.calls[0][1][0])).toContain('CARD sub-x');
  });

  it('⭐⭐ re-pointing the button changes the destination — no code change', async () => {
    const { engine, send } = engineWith([card('sub-a'), card('sub-x')]);
    await press(engine, 'sub-a');
    await press(engine, 'sub-x');
    expect(JSON.stringify(send.mock.calls[0][1][0])).toContain('CARD sub-a');
    expect(JSON.stringify(send.mock.calls[1][1][0])).toContain('CARD sub-x');
  });

  it('⚠️ PERM: a card from another OA is refused on this door too', async () => {
    const { engine, send } = engineWith([card('sub-a')]);
    const out = await press(
      engine,
      'sub-a',
      ctx({ hook: { group: 'other-oa' } }),
    );
    // still answered (fixed fallback), but never the other OA's card
    expect(out.handled).toBe(true);
    expect(JSON.stringify(send.mock.calls[0][1][0])).not.toContain(
      'CARD sub-a',
    );
  });

  it('a missing slug still answers the customer instead of hanging', async () => {
    const { engine, send } = engineWith([card('sub-a')]);
    const out = await press(engine, 'sub-nope');
    expect(out.handled).toBe(true);
    expect(send).toHaveBeenCalled();
  });

  it('respects the postback door switch', async () => {
    const { engine, send } = engineWith([card('sub-a')], {
      triggers: { tag: true, postback: false },
    });
    const out = await press(engine, 'sub-a');
    expect(out).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('is silent when the room is silenced', async () => {
    const { engine, send } = engineWith([card('sub-a')]);
    const out = await press(
      engine,
      'sub-a',
      ctx({ silence: { silenced: true, by: 'admin' } }),
    );
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });

  it('a foreign postback still falls through untouched', async () => {
    const { engine, send } = engineWith([card('sub-a')]);
    const out = await engine.handlePostback({
      data: 'pay:v1:whatever',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * ==== alt-text is never blank — found by the real-DB probe, not by a test ====
 *
 * A slug-opened menu has no scenario to borrow a title from, and the first
 * version sent `altText: ''`. LINE shows alt-text in the chat list and in push
 * notifications, so blank is what the customer would have seen where a preview
 * belongs. Every unit test passed; only pressing a real button showed it.
 */
describe('[SLUGLINK] alt-text is always something', () => {
  const withName = (name: unknown): StoredMenuCard => ({
    flex_type: 'menu',
    flex_slug: 'sub-a',
    group_ids: [GROUP],
    name: name as string,
    content_json: { type: 'bubble', body: { type: 'box', contents: [] } },
  });

  const open = async (card: StoredMenuCard | null) => {
    const send = jest.fn().mockResolvedValue({});
    const fixed = new FixedFlexRenderer();
    const engine = new MenuEngineService({
      sources: [{ get: () => null }],
      renderer: fixed,
      renderers: {
        fixed,
        stored: new StoredCardRenderer({
          source: { find: async () => card },
          fallback: fixed,
        }),
      },
      coreSend: send,
    });
    await engine.handlePostback({
      data: buildMenuOpenPostback('sub-a'),
      replyToken: 'rt',
      context: ctx(),
    });
    return send.mock.calls[0][1][0] as Record<string, unknown>;
  };

  it('⭐ uses the card name', async () => {
    expect((await open(withName('เมนูฝาก')))['altText']).toBe('เมนูฝาก');
  });

  it('falls back to the slug when the card is unnamed — never empty', async () => {
    expect((await open(withName('   ')))['altText']).toBe('sub-a');
  });

  it('is non-empty even when the card cannot be used at all', async () => {
    const alt = (await open(null))['altText'];
    expect(typeof alt).toBe('string');
    expect(String(alt).trim()).not.toBe('');
  });
});
