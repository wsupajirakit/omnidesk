/**
 * [FEAT-20260828-MENUTAG-S6] variables — REUSE, and the zero-impact half.
 *
 * PLAN §3e. Two things are pinned here and they matter in opposite directions:
 *
 *   1. WITHOUT the vars dep, every string is sent exactly as written. That is
 *      the module's pre-S6 behaviour, so wiring vars in cannot change a flow
 *      that does not opt in.
 *   2. WITH it, the menu calls CENTRAL functions and implements no grammar of
 *      its own. The stubs below stand in for `buildFlexVarMaps`,
 *      `applyFlexProfileVars`, `substituteCtxVars` and `renderFlexDoc`; the
 *      assertions are about WHICH one is called, with WHAT, and in WHAT ORDER —
 *      never about substitution itself, which is not this module's job.
 *
 * 🔴 The load-bearing case is `postback payloads are never substituted`. The
 * definition resolves BEFORE the renderer mints `menu:v1:…`, so no pass can
 * ever walk a payload. A tag inside a payload is a dead button, not a feature.
 */
import {
  MenuEngineService,
  MenuVarResolver,
  FixedFlexRenderer,
  parseMenuPostback,
  type MenuContext,
  type MenuDefinition,
  type MenuDefinitionSource,
  type MenuVarDeps,
} from '@/modules/menu';

const ctx = (over: Partial<MenuContext> = {}): MenuContext => ({
  hook: { _id: 'h1', domain: 'example.com' },
  lineUserId: 'U1',
  member: { id: 'm1', rawProfile: { profile: { name: 'Ann' } }, linked: true },
  siteRules: null,
  silence: { silenced: false, by: null },
  ...over,
});

/** Stand-ins for the four central functions, with their real shapes. */
const stubDeps = (over: Partial<MenuVarDeps> = {}): MenuVarDeps => ({
  buildDataVars: jest.fn(() => ({ 'profile.name': 'Ann' })),
  applyVars: jest.fn((node: unknown) =>
    typeof node === 'string' ? node.replace('{{profile.name}}', 'Ann') : node,
  ),
  substituteCtxVars: jest.fn((text: string) =>
    text.replace('{{hook_domain}}', 'example.com'),
  ),
  renderFlexDoc: jest.fn(() => ({ type: 'bubble', rendered: true })),
  ...over,
});

const defWith = (over: Partial<MenuDefinition> = {}): MenuDefinition => ({
  key: 'primary-a',
  level: 'primary',
  variant: 'a',
  enabled: true,
  title: 'สวัสดี {{profile.name}}',
  items: [
    {
      id: 'one',
      label: 'ดูข้อมูล {{profile.name}}',
      action: { type: 'result', result: { kind: 'text', text: 'x' } },
    },
  ],
  ...over,
});

const only = (d: MenuDefinition): MenuDefinitionSource[] => [{ get: () => d }];

const engine = (d: MenuDefinition, vars?: MenuVarResolver) => {
  const send = jest.fn().mockResolvedValue({});
  return {
    send,
    engine: new MenuEngineService({
      sources: only(d),
      renderer: new FixedFlexRenderer(),
      coreSend: send,
      vars,
    }),
  };
};

describe('[MENUVARS] without the dep — byte-identical, the pre-S6 behaviour', () => {
  it('⭐⭐⭐ every string is sent exactly as the scenario wrote it', async () => {
    const d = defWith({
      items: [
        {
          id: 'go',
          label: 'l',
          action: {
            type: 'result',
            result: { kind: 'text', text: 'hi {{profile.name}}' },
          },
        },
      ],
    });
    const { engine: e, send } = engine(d); // no vars dep at all
    await e.handlePostback({
      data: 'menu:v1:primary-a:go',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(send.mock.calls[0][1][0]).toEqual({
      type: 'text',
      text: 'hi {{profile.name}}',
    });
  });

  it('⭐⭐ the bubble keeps its raw title too', async () => {
    const { engine: e, send } = engine(defWith());
    await e.handleTap({
      text: '[[[menu-primary-a]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(send.mock.calls[0][1][0].altText).toBe('สวัสดี {{profile.name}}');
  });
});

describe('[MENUVARS] with the dep — central functions, right one per shape', () => {
  it('⭐⭐ text: data vars first, then the context vars OVER them', async () => {
    const deps = stubDeps();
    const d = defWith({
      items: [
        {
          id: 'go',
          label: 'l',
          action: {
            type: 'result',
            result: {
              kind: 'text',
              text: '{{profile.name}} @ {{hook_domain}}',
            },
          },
        },
      ],
    });
    const { engine: e, send } = engine(d, new MenuVarResolver(deps));
    await e.handlePostback({
      data: 'menu:v1:primary-a:go',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(send.mock.calls[0][1][0]).toEqual({
      type: 'text',
      text: 'Ann @ example.com',
    });
    /* the ORDER is the assertion: applyVars ran on the raw text, and
       substituteCtxVars ran on what applyVars produced */
    expect((deps.applyVars as jest.Mock).mock.calls[0][0]).toBe(
      '{{profile.name}} @ {{hook_domain}}',
    );
    expect((deps.substituteCtxVars as jest.Mock).mock.calls[0][0]).toBe(
      'Ann @ {{hook_domain}}',
    );
  });

  it('⭐⭐⭐ buildDataVars is called with (null doc, the raw profile, the hook)', async () => {
    const deps = stubDeps();
    const { engine: e } = engine(defWith(), new MenuVarResolver(deps));
    await e.handleTap({
      text: '[[[menu-primary-a]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect((deps.buildDataVars as jest.Mock).mock.calls[0]).toEqual([
      null,
      { profile: { name: 'Ann' } },
      { _id: 'h1', domain: 'example.com' },
    ]);
  });

  it('⭐⭐ flex goes through the FULL renderFlexDoc, wrapped as a doc', async () => {
    const deps = stubDeps();
    const flex = { type: 'bubble', body: { t: '{{profile.name}}' } };
    const d = defWith({
      items: [
        {
          id: 'go',
          label: 'l',
          action: {
            type: 'result',
            result: { kind: 'flex', flex, altText: 'hi {{profile.name}}' },
          },
        },
      ],
    });
    const { engine: e, send } = engine(d, new MenuVarResolver(deps));
    await e.handlePostback({
      data: 'menu:v1:primary-a:go',
      replyToken: 'rt',
      context: ctx(),
    });
    expect((deps.renderFlexDoc as jest.Mock).mock.calls[0][0]).toEqual({
      content_json: flex,
    });
    expect(send.mock.calls[0][1][0]).toEqual({
      type: 'flex',
      altText: 'hi Ann',
      contents: { type: 'bubble', rendered: true },
    });
  });

  it('⭐ image urls are resolved on both fields', async () => {
    const deps = stubDeps();
    const d = defWith({
      items: [
        {
          id: 'go',
          label: 'l',
          action: {
            type: 'result',
            result: {
              kind: 'image',
              imageUrl: 'https://x/{{profile.name}}.jpg',
            },
          },
        },
      ],
    });
    const { engine: e, send } = engine(d, new MenuVarResolver(deps));
    await e.handlePostback({
      data: 'menu:v1:primary-a:go',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(send.mock.calls[0][1][0]).toEqual({
      type: 'image',
      originalContentUrl: 'https://x/Ann.jpg',
      previewImageUrl: 'https://x/Ann.jpg',
    });
  });

  it('🔴🔴🔴 the postback payloads are NEVER substituted — the definition resolves first', async () => {
    /* If resolution ever moved to AFTER the renderer, a `{{` inside a label
       could not corrupt a payload — but a var map holding a key that matches a
       payload fragment could. Resolving first makes that structurally
       impossible, and this is what proves the order. */
    const deps = stubDeps();
    const { engine: e, send } = engine(defWith(), new MenuVarResolver(deps));
    await e.handleTap({
      text: '[[[menu-primary-a]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    const msg = send.mock.calls[0][1][0] as Record<string, unknown>;
    expect(msg.altText).toBe('สวัสดี Ann'); // title WAS resolved
    const body = (msg.contents as Record<string, unknown>).body as Record<
      string,
      unknown
    >;
    const button = (body.contents as Record<string, unknown>[]).find(
      (n) => n.type === 'button',
    )!;
    const action = button.action as Record<string, unknown>;
    expect(action.label).toBe('ดูข้อมูล Ann'); // label WAS resolved
    expect(parseMenuPostback(action.data)).toEqual({
      scenarioKey: 'primary-a',
      itemId: 'one',
    });
    /* and no central function was ever handed a payload */
    for (const call of (deps.applyVars as jest.Mock).mock.calls) {
      expect(String(call[0])).not.toContain('menu:v1:');
    }
  });
});

describe('[MENUVARS] the fast path and the failure path', () => {
  it('⭐⭐ a string with no `{{` is returned untouched and costs NO central call', () => {
    const deps = stubDeps();
    const r = new MenuVarResolver(deps);
    expect(r.resolveText('ไม่มีตัวแปร', { hook: {}, rawProfile: null })).toBe(
      'ไม่มีตัวแปร',
    );
    expect(deps.buildDataVars).not.toHaveBeenCalled();
    expect(deps.applyVars).not.toHaveBeenCalled();
    expect(deps.substituteCtxVars).not.toHaveBeenCalled();
  });

  it('⭐⭐ a definition with no variables is handed to the renderer UNCHANGED (identity)', () => {
    const r = new MenuVarResolver(stubDeps());
    const plain = defWith({ title: 'เมนู', items: [] });
    expect(r.resolveDefinition(plain, { hook: {}, rawProfile: null })).toBe(
      plain,
    );
  });

  it('⭐⭐⭐ a throwing APPLIER never silences the menu (the catch in resolveText)', async () => {
    /* The 28/08 backtest found this catch unreachable by any test: the only
       failure case drove buildDataVars, whose own catch swallows it first. The
       applier and the ctx substituter are what resolveText actually guards. */
    for (const broken of ['applyVars', 'substituteCtxVars'] as const) {
      const deps = stubDeps({
        [broken]: jest.fn(() => {
          throw new Error(`${broken} down`);
        }),
      });
      const d = defWith({
        items: [
          {
            id: 'go',
            label: 'l',
            action: {
              type: 'result',
              result: { kind: 'text', text: 'hi {{profile.name}}' },
            },
          },
        ],
      });
      const { engine: e, send } = engine(d, new MenuVarResolver(deps));
      const out = await e.handlePostback({
        data: 'menu:v1:primary-a:go',
        replyToken: 'rt',
        context: ctx(),
      });
      expect({ broken, action: out.action }).toEqual({
        broken,
        action: 'sent',
      });
      expect({ broken, msg: send.mock.calls[0][1][0] }).toEqual({
        broken,
        msg: { type: 'text', text: 'hi {{profile.name}}' },
      });
    }
  });

  it('⭐⭐⭐ a throwing CARD RENDERER sends the card unresolved rather than nothing', async () => {
    /* The flex twin of the case above, and the last of the three catches. A
       card whose tags stayed raw is still a card the customer can read and
       report; a swallowed send is a bot that went quiet for no visible reason. */
    const flex = { type: 'bubble', body: { t: '{{profile.name}}' } };
    const deps = stubDeps({
      renderFlexDoc: jest.fn(() => {
        throw new Error('render down');
      }),
    });
    const d = defWith({
      items: [
        {
          id: 'go',
          label: 'l',
          action: {
            type: 'result',
            result: { kind: 'flex', flex, altText: 'alt' },
          },
        },
      ],
    });
    const { engine: e, send } = engine(d, new MenuVarResolver(deps));
    const out = await e.handlePostback({
      data: 'menu:v1:primary-a:go',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.action).toBe('sent');
    expect(send.mock.calls[0][1][0]).toEqual({
      type: 'flex',
      altText: 'alt',
      contents: flex,
    });
  });

  it('⭐⭐ a throwing BUILDER degrades to an empty map — the applier still runs', () => {
    /* Distinct from the case above: dataVars() has its own catch, so a dead
       dictionary must not stop substitution — it just leaves the tags literal
       through the central applier's own unknown-tag rule. */
    const deps = stubDeps({
      buildDataVars: jest.fn(() => {
        throw new Error('dict down');
      }),
    });
    const r = new MenuVarResolver(deps);
    r.resolveText('hi {{profile.name}}', { hook: {}, rawProfile: null });
    expect((deps.applyVars as jest.Mock).mock.calls[0][1]).toEqual({});
  });

  it('⭐⭐⭐ a throwing central dep never silences the menu — the raw tag is sent', async () => {
    /* The alternative is a customer meeting silence because a dictionary lookup
       failed. A visible `{{profile.name}}` is reportable; silence is not. */
    const deps = stubDeps({
      buildDataVars: jest.fn(() => {
        throw new Error('dict down');
      }),
      applyVars: jest.fn((n: unknown) => n),
      substituteCtxVars: jest.fn((t: string) => t),
    });
    const d = defWith({
      items: [
        {
          id: 'go',
          label: 'l',
          action: {
            type: 'result',
            result: { kind: 'text', text: 'hi {{profile.name}}' },
          },
        },
      ],
    });
    const { engine: e, send } = engine(d, new MenuVarResolver(deps));
    const out = await e.handlePostback({
      data: 'menu:v1:primary-a:go',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.action).toBe('sent');
    expect(send.mock.calls[0][1][0]).toEqual({
      type: 'text',
      text: 'hi {{profile.name}}',
    });
  });
});
