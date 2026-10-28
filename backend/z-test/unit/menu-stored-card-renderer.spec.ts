/* Fixture sources are synchronous by nature but must satisfy the async port,
   so `require-await` has nothing to find here. Test file only. */
/* eslint-disable @typescript-eslint/require-await */
/**
 * [FEAT-20260829-MENUSTORED] the stored-card renderer.
 *
 * The card fixture is the REAL shape read out of `flex_messages` on 29/08/2026
 * (flex_type "menu", flex_sub_type "main", flex_slug "1234", a `bubble` in
 * content_json, 22 ids in group_ids) — not an invented one, because the whole
 * point of this renderer is surviving what the collection actually holds.
 *
 * What each block pins, and why it is worth a test:
 *   · the five refusal layers — every one of them is a way a customer silently
 *     receives the wrong OA's card or no card at all
 *   · buttons are MINTED, never trusted — an operator cannot type a valid
 *     `menu:v1:` payload, so a card whose buttons were taken at face value is a
 *     dead menu that looks perfect in the editor
 *   · `uri` repair — LINE rejects the WHOLE message for one bad uri, so this is
 *     the difference between "a button does nothing" and "no card arrives"
 *   · no mutation of the stored doc — a shared document poisoned by one reply
 *     would leak the previous customer's payloads into the next
 */
import {
  StoredCardRenderer,
  mintButtons,
  parseMenuPostback,
  type MenuDefinition,
  type MenuContext,
  type StoredMenuCard,
  type MenuRenderer,
} from '@/modules/menu';

const GROUP = 'a0d00000000000000000006d';

/** The real row's shape — see the header. */
const realCard = (over: Partial<StoredMenuCard> = {}): StoredMenuCard => ({
  name: 'main menu',
  flex_type: 'menu',
  flex_sub_type: 'main',
  flex_slug: '1234',
  group_ids: [GROUP, 'a0d00000000000000000006e'],
  content_json: {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'MAIN MENU' },
        {
          type: 'button',
          action: {
            type: 'postback',
            label: 'ฝาก',
            data: 'whatever-the-operator-left',
          },
        },
        {
          type: 'button',
          action: { type: 'uri', label: 'ถอน', uri: 'mintt xx' },
        },
      ],
    },
  },
  ...over,
});

const def = (over: Partial<MenuDefinition> = {}): MenuDefinition => ({
  key: 'primary',
  level: 'primary',
  variant: null,
  enabled: true,
  title: 'เมนูหลัก',
  items: [
    {
      id: 'dep',
      label: 'ฝาก',
      action: { type: 'result', result: { kind: 'text', text: 'ฝาก' } },
    },
    {
      id: 'wd',
      label: 'ถอน',
      action: { type: 'result', result: { kind: 'text', text: 'ถอน' } },
    },
  ],
  render: 'stored',
  card: { flexType: 'menu', subType: 'main' },
  ...over,
});

/* `hook` always exists; passing `null` means the hook carries no group —
   a default parameter cannot express that, which is why this takes an object. */
const ctx = (
  hook: Record<string, unknown> = { group: GROUP },
): MenuContext => ({
  hook,
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false, by: null },
});

const FALLBACK_MARK = '__fixed_fallback__';
const fallback: MenuRenderer = {
  render: (d) => ({
    type: 'flex',
    altText: d.title,
    contents: { [FALLBACK_MARK]: true },
  }),
};

const make = (
  find: () => Promise<StoredMenuCard | null>,
  warn?: (r: string, d: string) => void,
) => new StoredCardRenderer({ source: { find }, fallback, warn: warn });

const isFallback = (msg: Record<string, unknown>): boolean =>
  Boolean((msg['contents'] as Record<string, unknown>)?.[FALLBACK_MARK]);

/** Pull every action out of a rendered bubble, in document order. */
function actionsOf(msg: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o['action']) out.push(o['action'] as Record<string, unknown>);
    Object.values(o).forEach(walk);
  };
  walk(msg['contents']);
  return out;
}

describe('[MENUSTORED] refusal layers — the customer always gets a menu', () => {
  const cases: Array<[string, StoredMenuCard | null, string]> = [
    ['nothing matched the card ref', null, 'not-found'],
    [
      'the card was soft-deleted',
      realCard({ deleted_at: new Date() }),
      'deleted',
    ],
    [
      'the card is another flex type',
      realCard({ flex_type: 'slip' }),
      'wrong-type',
    ],
    [
      'the card has no content',
      realCard({ content_json: null }),
      'empty-content',
    ],
    [
      'the card belongs to another OA',
      realCard({ group_ids: ['someone-else'] }),
      'other-group',
    ],
  ];

  it.each(cases)('falls back when %s', async (_label, card, reason) => {
    const seen: string[] = [];
    const msg = await make(
      async () => card,
      (r) => seen.push(r),
    ).render(def(), ctx());
    expect(isFallback(msg)).toBe(true);
    expect(seen).toEqual([reason]);
  });

  it('falls back when the scenario names no card at all', async () => {
    const seen: string[] = [];
    const msg = await make(
      async () => realCard(),
      (r) => seen.push(r),
    ).render(def({ card: undefined }), ctx());
    expect(isFallback(msg)).toBe(true);
    expect(seen).toEqual(['no-card-ref']);
  });

  it('falls back — never throws — when the read itself fails', async () => {
    const seen: string[] = [];
    const msg = await make(
      async () => {
        throw new Error('mongo down');
      },
      (r) => seen.push(r),
    ).render(def(), ctx());
    expect(isFallback(msg)).toBe(true);
    expect(seen).toEqual(['read-failed']);
  });

  it('refuses a card when the hook has no group at all (fail closed)', async () => {
    const msg = await make(async () => realCard()).render(def(), ctx({}));
    expect(isFallback(msg)).toBe(true);
  });

  it('a warn that throws still costs nobody the reply', async () => {
    const msg = await make(
      async () => null,
      () => {
        throw new Error('logger exploded');
      },
    ).render(def(), ctx());
    expect(isFallback(msg)).toBe(true);
  });
});

describe('[MENUSTORED] a good card is used, with minted buttons', () => {
  it('sends the operator card, not the fixed one', async () => {
    const msg = await make(async () => realCard()).render(def(), ctx());
    expect(isFallback(msg)).toBe(false);
    expect(msg['type']).toBe('flex');
    /* ⚠️ FLIPPED 29/08: the CARD's name now wins over the definition's title.
       Reason: a slug-opened menu has no scenario, so `definition.title` there is
       only the slug — and even with a scenario, the title is a developer's
       string while the card name is what the operator typed. The old
       expectation ('เมนูหลัก', the definition) is kept in this note so the
       change of mind stays visible rather than looking like a test edited to
       pass. */
    expect(msg['altText']).toBe('main menu');
    expect((msg['contents'] as Record<string, unknown>)['type']).toBe('bubble');
  });

  it('replaces whatever the operator typed with a real postback, in item order', async () => {
    const msg = await make(async () => realCard()).render(def(), ctx());
    const acts = actionsOf(msg);
    expect(acts).toHaveLength(2);
    expect(acts.map((a) => a['type'])).toEqual(['postback', 'postback']);
    expect(acts.map((a) => parseMenuPostback(a['data'])?.itemId)).toEqual([
      'dep',
      'wd',
    ]);
  });

  it('turns a uri button LINE would reject into a working postback', async () => {
    // 'mintt xx' is the real typo class that killed the helper card before.
    const msg = await make(async () => realCard()).render(def(), ctx());
    const acts = actionsOf(msg);
    expect(acts.every((a) => a['type'] !== 'uri')).toBe(true);
    expect(parseMenuPostback(acts[1]!['data'])).not.toBeNull();
  });

  it('keeps the label the operator drew', async () => {
    const msg = await make(async () => realCard()).render(def(), ctx());
    expect(actionsOf(msg).map((a) => a['label'])).toEqual(['ฝาก', 'ถอน']);
  });

  it('asks the source for the type and sub-type the scenario named', async () => {
    const asked: unknown[] = [];
    const r = new StoredCardRenderer({
      source: {
        find: async (q) => {
          asked.push(q);
          return realCard();
        },
      },
      fallback,
    });
    await r.render(def(), ctx());
    expect(asked).toEqual([{ flexType: 'menu', subType: 'main' }]);
  });
});

describe('[MENUSTORED] mintButtons — the parts that silently corrupt', () => {
  it('never mutates the stored document', () => {
    const card = realCard();
    const before = JSON.stringify(card.content_json);
    mintButtons(card.content_json as Record<string, unknown>, def());
    expect(JSON.stringify(card.content_json)).toBe(before);
  });

  it('leaves a non-button action (message/camera) exactly as drawn', () => {
    const doc = {
      type: 'bubble',
      body: {
        type: 'box',
        contents: [
          {
            type: 'button',
            action: { type: 'message', label: 'คุยกับแอดมิน', text: 'สวัสดี' },
          },
        ],
      },
    };
    const out = mintButtons(doc, def());
    expect(actionsOf({ contents: out })).toEqual([
      { type: 'message', label: 'คุยกับแอดมิน', text: 'สวัสดี' },
    ]);
  });

  it('keeps a real http link when there is no item left to bind', () => {
    const doc = {
      type: 'bubble',
      body: {
        type: 'box',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: 'a', data: 'x' },
          },
          {
            type: 'button',
            action: { type: 'postback', label: 'b', data: 'x' },
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'เว็บ', uri: 'https://example.com' },
          },
        ],
      },
    };
    const acts = actionsOf({ contents: mintButtons(doc, def()) });
    expect(acts).toHaveLength(3);
    expect(acts[2]).toEqual({
      type: 'uri',
      label: 'เว็บ',
      uri: 'https://example.com',
    });
  });

  it('DROPS a leftover broken uri rather than losing the whole message', () => {
    const doc = {
      type: 'bubble',
      body: {
        type: 'box',
        contents: [
          {
            type: 'button',
            action: { type: 'postback', label: 'a', data: 'x' },
          },
          {
            type: 'button',
            action: { type: 'postback', label: 'b', data: 'x' },
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'ยังไม่เสร็จ', uri: 'mintt xx' },
          },
        ],
      },
    };
    const acts = actionsOf({ contents: mintButtons(doc, def()) });
    expect(acts).toHaveLength(2);
    expect(acts.every((a) => a['type'] === 'postback')).toBe(true);
  });

  it('mints buttons nested at any depth, in document order', () => {
    const doc = {
      type: 'bubble',
      body: {
        type: 'box',
        contents: [
          {
            type: 'box',
            contents: [
              {
                type: 'button',
                action: { type: 'postback', label: 'x', data: 'q' },
              },
            ],
          },
          {
            type: 'box',
            contents: [
              {
                type: 'box',
                contents: [
                  {
                    type: 'button',
                    action: { type: 'postback', label: 'y', data: 'q' },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const acts = actionsOf({ contents: mintButtons(doc, def()) });
    expect(acts.map((a) => parseMenuPostback(a['data'])?.itemId)).toEqual([
      'dep',
      'wd',
    ]);
  });
});

/**
 * ==== the slug regression — a fixture that answers like a real collection ====
 *
 * These exist because the earlier fixtures could not fail: a source that returns
 * ONE row no matter what is asked will pass whether or not the renderer forwards
 * the query. Against the real DB on 29/08/2026 all 7 `primary*` scenarios
 * silently rendered the SAME card, because they share `sub_type: "main"` and the
 * slug was being dropped before the query.
 *
 * So this fake FILTERS, exactly as Mongo would. That is the whole point.
 */
describe('[MENUSTORED] the card ref must identify ONE card', () => {
  const shelf: StoredMenuCard[] = ['primary', 'primary-a', 'second'].map(
    (k) => ({
      ...realCard(),
      name: `MENU ${k}`,
      flex_slug: `menu-seed-${k}`,
      flex_sub_type: k.startsWith('primary') ? 'main' : 'sub',
    }),
  );

  /** Answers like the collection: every stated key must match. */
  const filtering = new StoredCardRenderer({
    source: {
      find: async (q) =>
        shelf.find(
          (c) =>
            c.flex_type === q.flexType &&
            (q.subType === undefined || c.flex_sub_type === q.subType) &&
            (q.slug === undefined || c.flex_slug === q.slug),
        ) ?? null,
    },
    fallback,
  });

  it('picks the card the slug names, not the first of its sub-type', async () => {
    const asked: string[] = [];
    const r = new StoredCardRenderer({
      source: {
        find: async (q) => {
          asked.push(String(q.slug));
          return shelf.find((c) => c.flex_slug === q.slug) ?? null;
        },
      },
      fallback,
    });
    await r.render(
      def({
        card: {
          flexType: 'menu',
          subType: 'main',
          slug: 'menu-seed-primary-a',
        },
      }),
      ctx(),
    );
    expect(asked).toEqual(['menu-seed-primary-a']);
  });

  it('two scenarios sharing a sub-type resolve to DIFFERENT cards', async () => {
    const a = await filtering.render(
      def({
        key: 'primary',
        card: { flexType: 'menu', subType: 'main', slug: 'menu-seed-primary' },
      }),
      ctx(),
    );
    const b = await filtering.render(
      def({
        key: 'primary-a',
        card: {
          flexType: 'menu',
          subType: 'main',
          slug: 'menu-seed-primary-a',
        },
      }),
      ctx(),
    );
    expect(isFallback(a)).toBe(false);
    expect(isFallback(b)).toBe(false);
    // the payloads carry each scenario's own key — the bug made both say 'primary'
    const keyOf = (m: Record<string, unknown>) =>
      parseMenuPostback(actionsOf(m)[0]!['data'])?.scenarioKey;
    expect([keyOf(a), keyOf(b)]).toEqual(['primary', 'primary-a']);
  });

  it('refuses when the named slug matches nothing', async () => {
    const seen: string[] = [];
    const r = new StoredCardRenderer({
      source: {
        find: async (q) => shelf.find((c) => c.flex_slug === q.slug) ?? null,
      },
      fallback,
      warn: (reason) => seen.push(reason),
    });
    const msg = await r.render(
      def({
        card: { flexType: 'menu', subType: 'main', slug: 'menu-seed-nope' },
      }),
      ctx(),
    );
    expect(isFallback(msg)).toBe(true);
    expect(seen).toEqual(['not-found']);
  });

  it('still works with no slug when a level has exactly one card', async () => {
    const msg = await filtering.render(
      def({ card: { flexType: 'menu', subType: 'sub' } }),
      ctx(),
    );
    expect(isFallback(msg)).toBe(false);
  });
});

/**
 * ==== label safety — found by a mutation that stayed GREEN ====
 *
 * The renderer prefers the label the operator drew and falls back to the item's.
 * Removing that preference broke nothing in the suite on 29/08/2026, which meant
 * the rule was unowned: the next person to "simplify" it would have seen green.
 * A non-string label is the case that matters — `String()` on an object yields
 * the literal "[object Object]" on the customer's button.
 */
describe('[MENUSTORED] button labels', () => {
  const withLabel = (label: unknown) => ({
    type: 'bubble',
    body: {
      type: 'box',
      contents: [
        { type: 'button', action: { type: 'postback', label, data: 'x' } },
      ],
    },
  });

  it('keeps the operator label when it is real text', () => {
    const acts = actionsOf({
      contents: mintButtons(withLabel('ฝากเงิน'), def()),
    });
    expect(acts[0]!['label']).toBe('ฝากเงิน');
  });

  it('falls back to the item label when the card has none', () => {
    const acts = actionsOf({
      contents: mintButtons(withLabel(undefined), def()),
    });
    expect(acts[0]!['label']).toBe('ฝาก');
  });

  it('falls back when the label is blank rather than sending an empty button', () => {
    const acts = actionsOf({ contents: mintButtons(withLabel('   '), def()) });
    expect(acts[0]!['label']).toBe('ฝาก');
  });

  it('never lets a non-string label reach the customer as [object Object]', () => {
    const acts = actionsOf({
      contents: mintButtons(withLabel({ th: 'ฝาก' }), def()),
    });
    expect(acts[0]!['label']).toBe('ฝาก');
    expect(JSON.stringify(acts[0])).not.toContain('object Object');
  });
});
