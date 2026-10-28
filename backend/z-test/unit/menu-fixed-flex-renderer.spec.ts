/**
 * [FEAT-20260828-MENUTAG-S2] the look contract of today's only renderer.
 *
 * WRITTEN AFTER A BACKTEST FOUND IT UNASSERTED (28/08). The renderer was
 * CONSTRUCTED by the engine specs but nothing ever read what it produced, so
 * three mutations survived a fully green suite:
 *   · every button turned into `type:'message'` — the postback door dies in
 *     production (a tap sends TEXT, the engine never sees a payload) and
 *     nothing errors until a real customer taps
 *   · every button's data hard-written as `menu:open` — the exact foreign
 *     payload plan R16 requires to stay NOT OURS
 *   · altText detached from the scenario's own title
 * None of the three raises an error anywhere. They just quietly do not work,
 * which is why the codec round-trip below is the assertion that matters:
 * it proves the button a customer taps is a payload the engine can parse.
 *
 * PLAN §3f (renderer seam) / §3c (codec is the only minter).
 */
import {
  FixedFlexRenderer,
  SCENARIOS,
  parseMenuPostback,
  type MenuContext,
  type MenuDefinition,
  type MenuRenderer,
} from '@/modules/menu';

type Node = Record<string, unknown>;

const ctx: MenuContext = {
  hook: { _id: 'h1' },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false, by: null },
};

/* Held as the PORT type, not the class: the seam outsiders get is
   `MenuRenderer`, so the spec exercises the same two-argument signature a
   future renderer will be called through. */
const renderer: MenuRenderer = new FixedFlexRenderer();

const render = (def: MenuDefinition): Node => renderer.render(def, ctx);

const bodyContents = (msg: Node): Node[] =>
  ((msg.contents as Node).body as Node).contents as Node[];

const buttonsOf = (msg: Node): Node[] =>
  bodyContents(msg).filter((n) => n.type === 'button');

const sample: MenuDefinition = {
  key: 'primary-a',
  level: 'primary',
  variant: 'a',
  enabled: true,
  title: 'หัวข้อเมนู',
  items: [
    {
      id: 'one',
      label: 'ตัวเลือกหนึ่ง',
      action: { type: 'result', result: { kind: 'text', text: 'x' } },
    },
    {
      id: 'go-second',
      label: 'เมนูย่อย',
      action: { type: 'open', target: 'second-a' },
    },
  ],
};

describe('[MENURENDER] the fixed flex bubble', () => {
  it('⭐⭐ is a flex message whose altText is the scenario title', () => {
    const msg = render(sample);
    expect(msg.type).toBe('flex');
    expect(msg.altText).toBe('หัวข้อเมนู');
    expect((msg.contents as Node).type).toBe('bubble');
  });

  it('⭐ the title is the first node, then one button per item in order', () => {
    const nodes = bodyContents(render(sample));
    expect(nodes[0]).toMatchObject({ type: 'text', text: 'หัวข้อเมนู' });
    expect(
      buttonsOf(render(sample)).map((b) => (b.action as Node).label),
    ).toEqual(['ตัวเลือกหนึ่ง', 'เมนูย่อย']);
  });

  it('🔴🔴 every button is a POSTBACK action — a `message` button kills the door silently', () => {
    /* If this ever becomes 'message', tapping sends the LABEL as chat text.
       The engine's postback door never fires, the text door sees prose that is
       not a tag, and the customer gets the ordinary flow with no error. */
    for (const b of buttonsOf(render(sample))) {
      expect((b.action as Node).type).toBe('postback');
    }
  });

  it('🔴🔴🔴 every button data round-trips through the codec back to (key, itemId)', () => {
    /* The codec is the ONLY minter (§3c). A hand-written payload — `menu:open`
       above all — parses as NOT OURS and the button is dead on arrival. */
    const msg = render(sample);
    expect(
      buttonsOf(msg).map((b) => parseMenuPostback((b.action as Node).data)),
    ).toEqual([
      { scenarioKey: 'primary-a', itemId: 'one' },
      { scenarioKey: 'primary-a', itemId: 'go-second' },
    ]);
  });

  it('⭐⭐⭐ EVERY shipped scenario renders, and every one of its buttons round-trips', () => {
    /* Sweeps the real registry rather than a fixture, so the day someone adds
       a scenario with an unrenderable item id or a title long enough to push a
       payload past LINE's 300-byte cap, this goes red at build time — never at
       the customer. Placeholders included: they ship disabled, but a disabled
       scenario is still rendered the moment the owner flips one on. */
    for (const def of SCENARIOS.values()) {
      const msg = render(def);
      expect({ key: def.key, altText: msg.altText }).toEqual({
        key: def.key,
        altText: def.title,
      });
      const seen = buttonsOf(msg).map((b) =>
        parseMenuPostback((b.action as Node).data),
      );
      expect({ key: def.key, seen }).toEqual({
        key: def.key,
        seen: def.items.map((i) => ({
          scenarioKey: def.key,
          itemId: i.id,
        })),
      });
    }
  });
});
