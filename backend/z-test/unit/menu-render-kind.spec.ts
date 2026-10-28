/**
 * [FEAT-20260829-RENDERKIND] the renderer seam, made real.
 *
 * WHY THIS EXISTS: `MenuDefinition.render` was declared from S1 as "the renderer
 * seam" and NOTHING read it — the engine always used its single injected
 * renderer. A seam nobody reads is decoration, and the 29/08 dive found it while
 * planning cards that will come from the flex-message collection instead of from
 * code.
 *
 * What is pinned here:
 *   · no map ⇒ the default renderer draws everything (today's behaviour, exactly)
 *   · a definition naming a registered kind gets THAT renderer
 *   · an UNKNOWN kind falls back instead of throwing — a typo in one scenario
 *     file must never take a customer's menu down
 *   · an ASYNC renderer is awaited, because a stored card is a DB read
 *   · switching one scenario does not touch its neighbour — that is what makes
 *     the change reversible one file at a time
 */
import {
  MenuEngineService,
  FixedFlexRenderer,
  type MenuContext,
  type MenuDefinition,
  type MenuDefinitionSource,
  type MenuRenderer,
} from '@/modules/menu';

const ctx = (): MenuContext => ({
  hook: { _id: 'h1' },
  lineUserId: 'U1',
  member: { id: 'm1', rawProfile: null, linked: false },
  siteRules: null,
  silence: { silenced: false, by: null },
});

const def = (over: Partial<MenuDefinition> = {}): MenuDefinition => ({
  key: 'primary-a',
  level: 'primary',
  variant: 'a',
  enabled: true,
  title: 'menu',
  items: [
    {
      id: 'x',
      label: 'x',
      action: { type: 'result', result: { kind: 'text', text: 't' } },
    },
  ],
  ...over,
});

const marker = (name: string): MenuRenderer => ({
  render: () => ({ type: 'flex', altText: name, contents: { drawnBy: name } }),
});

const run = async (d: MenuDefinition, renderers?: Record<string, unknown>) => {
  const send = jest.fn().mockResolvedValue({});
  const sources: MenuDefinitionSource[] = [{ get: () => d }];
  const engine = new MenuEngineService({
    sources,
    renderer: new FixedFlexRenderer(),
    coreSend: send,
    ...(renderers ? { renderers: renderers as never } : {}),
  });
  const out = await engine.handleTap({
    text: '[[[menu-primary-a]]]',
    replyToken: 'rt',
    context: ctx(),
  });
  return { out, msg: send.mock.calls[0]?.[1]?.[0] as Record<string, unknown> };
};

describe('[MENURENDERKIND] the renderer a scenario asks for', () => {
  it('⭐⭐⭐ with NO map, everything draws with the default renderer', async () => {
    const { out, msg } = await run(def());
    expect(out.action).toBe('sent');
    expect(msg.type).toBe('flex');
    expect(msg.altText).toBe('menu'); // the fixed renderer's shape
  });

  it('⭐⭐⭐ a definition naming a registered kind gets THAT renderer', async () => {
    const { msg } = await run(def({ render: 'stored' }), {
      stored: marker('stored'),
    });
    expect(msg.contents).toEqual({ drawnBy: 'stored' });
  });

  it('⭐⭐⭐ an UNKNOWN kind falls back to the default and never throws', async () => {
    /* A typo in one scenario file must not take a customer's menu down. It
       stays visible because the fixed card arrives instead of the stored one. */
    const { out, msg } = await run(
      def({ render: 'nonsense' as unknown as 'fixed' }),
      { stored: marker('stored') },
    );
    expect(out.action).toBe('sent');
    expect(msg.altText).toBe('menu');
  });

  it("⭐⭐ 'fixed' can be overridden in the map without touching any scenario", async () => {
    const { msg } = await run(def({ render: 'fixed' }), {
      fixed: marker('replaced'),
    });
    expect(msg.contents).toEqual({ drawnBy: 'replaced' });
  });

  it('⭐⭐⭐ an ASYNC renderer is awaited — a stored card is a DB read', async () => {
    const slow = {
      render: () =>
        Promise.resolve({ type: 'flex', altText: 'async', contents: {} }),
    };
    const { msg } = await run(def({ render: 'stored' }), { stored: slow });
    expect(msg.altText).toBe('async');
  });

  it('⭐⭐ switching ONE scenario leaves its neighbour on the default', async () => {
    /* This is what makes the migration reversible one file at a time. */
    const a = await run(def({ render: 'stored' }), {
      stored: marker('stored'),
    });
    const b = await run(def({ key: 'primary', variant: null }), {
      stored: marker('stored'),
    });
    expect(a.msg.contents).toEqual({ drawnBy: 'stored' });
    expect(b.msg.altText).toBe('menu');
  });

  it('⭐ the card reference travels with the definition, untouched by the fixed renderer', async () => {
    /* `card` names the flex-message type and sub-type a stored renderer will
       query. The fixed renderer must ignore it rather than choke on it. */
    const seen: MenuDefinition[] = [];
    const spy: MenuRenderer = {
      render: (d) => {
        seen.push(d);
        return { type: 'flex', altText: 'x', contents: {} };
      },
    };
    await run(
      def({
        render: 'stored',
        card: { flexType: 'menu', subType: 'primary-a' },
      }),
      { stored: spy },
    );
    expect(seen[0]!.card).toEqual({ flexType: 'menu', subType: 'primary-a' });
    const plain = await run(def({ card: { flexType: 'menu' } }));
    expect(plain.out.action).toBe('sent');
  });
});
