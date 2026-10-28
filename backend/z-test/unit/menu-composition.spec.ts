/* eslint-disable @typescript-eslint/require-await */
/**
 * [FEAT-20260829-MENUCOMP] the shipped assembler.
 *
 * ⭐ THE CASE THAT MATTERS: before this file existed, the engine was constructed
 * only inside spec files. A scenario set to `render: 'stored'` would then have
 * drawn the FIXED card in production — silently, with every test green — because
 * `renderWith` falls back when no renderer map is supplied. These cases pin the
 * assembly so that trap cannot come back.
 */
import {
  createMenuEngine,
  buildRendererMap,
  buildSources,
  CodeRegistrySource,
  type MenuWiring,
  type MenuContext,
  type MenuDefinition,
  type StoredMenuCard,
} from '@/modules/menu';

const GROUP = 'g1';

const ctx = (): MenuContext => ({
  hook: { group: GROUP },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false, by: null },
});

const storedCard: StoredMenuCard = {
  flex_type: 'menu',
  flex_sub_type: 'main',
  flex_slug: 'seed',
  group_ids: [GROUP],
  content_json: {
    type: 'bubble',
    body: {
      type: 'box',
      contents: [
        { type: 'button', action: { type: 'postback', label: 'A', data: 'x' } },
      ],
    },
  },
};

/** A scenario that asks for a stored card. */
const storedDef = (): MenuDefinition => ({
  key: 'primary',
  level: 'primary',
  variant: null,
  enabled: true,
  title: 'จากการ์ดจริง',
  items: [
    {
      id: 'a',
      label: 'A',
      action: { type: 'result', result: { kind: 'text', text: 'a' } },
    },
  ],
  render: 'stored',
  card: { flexType: 'menu', subType: 'main' },
});

const wiring = (over: Partial<MenuWiring> = {}): MenuWiring => ({
  coreSend: jest.fn().mockResolvedValue({}),
  ...over,
});

describe('[MENUCOMP] the renderer map', () => {
  it('registers ONLY fixed when no card reader was supplied', () => {
    const map = buildRendererMap(wiring());
    expect(Object.keys(map)).toEqual(['fixed']);
  });

  it('registers stored as soon as a card reader is supplied', () => {
    const map = buildRendererMap(wiring({ cards: { find: async () => null } }));
    expect(Object.keys(map).sort()).toEqual(['fixed', 'stored']);
  });

  it('does NOT register stored with a missing reader — that would refuse every menu while looking configured', () => {
    expect(
      buildRendererMap(wiring({ cards: undefined })).stored,
    ).toBeUndefined();
  });
});

describe('[MENUCOMP] the source chain', () => {
  it('the code registry is last with no front sources', () => {
    const s = buildSources(wiring());
    expect(s).toHaveLength(1);
    expect(s[0]).toBeInstanceOf(CodeRegistrySource);
  });

  it('front sources come FIRST and the registry stays last', () => {
    const front = { get: () => null };
    const s = buildSources(wiring({ frontSources: [front] }));
    expect(s[0]).toBe(front);
    expect(s[s.length - 1]).toBeInstanceOf(CodeRegistrySource);
  });
});

describe('[MENUCOMP] ⭐ a stored scenario really draws the stored card', () => {
  const run = async (over: Partial<MenuWiring>) => {
    const send = jest.fn().mockResolvedValue({});
    const engine = createMenuEngine({
      ...wiring(over),
      coreSend: send,
      frontSources: [{ get: () => storedDef() }],
    });
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    return {
      out,
      msg: send.mock.calls[0]?.[1]?.[0] as Record<string, unknown>,
    };
  };

  it('draws from the DB card when a reader is wired', async () => {
    const { out, msg } = await run({ cards: { find: async () => storedCard } });
    expect(out.action).toBe('sent');
    // the stored card's own bubble, not the fixed renderer's title+buttons shape
    expect(JSON.stringify(msg)).toContain('menu:v1:primary:a');
    expect((msg['contents'] as Record<string, unknown>)['type']).toBe('bubble');
  });

  it('falls back to the fixed card when no reader is wired — and stays safe', async () => {
    const { out, msg } = await run({});
    expect(out.action).toBe('sent'); // the customer still gets a menu
    expect(msg['altText']).toBe('จากการ์ดจริง');
  });

  it('reports WHY a stored card was refused, so a wiring mistake is audible', async () => {
    const seen: string[] = [];
    await run({
      cards: { find: async () => null },
      onCardRefused: (reason) => seen.push(reason),
    });
    expect(seen).toEqual(['not-found']);
  });
});

describe('[MENUCOMP] optional deps are opt-in, never invented', () => {
  it('an engine builds with nothing but a send seam', async () => {
    const send = jest.fn().mockResolvedValue({});
    const engine = createMenuEngine({ coreSend: send });
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.handled).toBe(true);
    expect(send).toHaveBeenCalled();
  });

  it('a closed tag door makes the engine fall through byte-identically', async () => {
    const send = jest.fn().mockResolvedValue({});
    const engine = createMenuEngine({
      coreSend: send,
      triggers: { tag: false, postback: true },
    });
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.handled).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * ==== optional deps must actually REACH the engine ====
 *
 * `createMenuEngine` spreads `vars` / `triggers` / `log` conditionally. A
 * conditional spread that names the wrong key, or is dropped, compiles fine and
 * silently disables the feature — the same field-drop class that has bitten this
 * codebase before. `triggers` was already covered by the closed-door case; these
 * pin the other two, so all three optional deps are proven to arrive.
 */
describe('[MENUCOMP] every optional dep reaches the engine', () => {
  const tap = (over: Partial<MenuWiring>) => {
    const send = jest.fn().mockResolvedValue({});
    const engine = createMenuEngine({ ...wiring(over), coreSend: send });
    return {
      send,
      run: () =>
        engine.handleTap({
          text: '[[[menu-primary]]]',
          replyToken: 'rt',
          context: ctx(),
        }),
    };
  };

  it('`vars` is used — a variable in the title is resolved before sending', async () => {
    const resolveDefinition = jest.fn((d: MenuDefinition) => ({
      ...d,
      title: 'RESOLVED',
    }));
    const { send, run } = tap({
      vars: {
        resolveDefinition,
        resolveText: (t: string) => t,
        resolveFlex: (f: unknown) => f,
      } as never,
    });
    await run();
    expect(resolveDefinition).toHaveBeenCalled();
    const msg = send.mock.calls[0]![1]![0] as Record<string, unknown>;
    expect(msg['altText']).toBe('RESOLVED');
  });

  it('with no `vars`, strings are sent exactly as the scenario wrote them', async () => {
    const { send, run } = tap({});
    await run();
    const msg = send.mock.calls[0]![1]![0] as Record<string, unknown>;
    expect(msg['altText']).not.toBe('RESOLVED');
  });

  it('`log` receives the send event', async () => {
    const events: { kind: string }[] = [];
    const { run } = tap({ log: (e) => events.push(e) });
    await run();
    expect(events.map((e) => e.kind)).toContain('send');
  });

  it('a log that THROWS never costs the customer the menu', async () => {
    const { send, run } = tap({
      log: () => {
        throw new Error('logger exploded');
      },
    });
    const out = await run();
    expect(out.action).toBe('sent');
    expect(send).toHaveBeenCalled();
  });
});
