/**
 * [FEAT-20260828-MENUTAG-S1] the engine's decisions — every one a plan rule.
 * PLAN §3c/§3d/§3f. Pure: no Nest, every collaborator injected.
 *
 * What is pinned here, and why each matters:
 *   · not ours ⇒ handled:false — the webhook falls through byte-identical (C1)
 *   · suspended/blocked ⇒ handled + SILENT (the strike-suspend stance)
 *   · disabled scenario ⇒ never sends (the a-f placeholders are disabled today)
 *   · source chain: first non-null wins, code registry LAST; a front source
 *     answering {enabled:false} disables ONE scenario while its neighbour still
 *     falls through — per-scenario independence, no bleed
 *   · send failure THROWS through (§3c: reaching the line after the send is the
 *     proof of delivery the caller's wlog success row rests on)
 */
import {
  MenuEngineService,
  CodeRegistrySource,
  FixedFlexRenderer,
  SCENARIOS,
  type MenuContext,
  type MenuDefinition,
  type MenuDefinitionSource,
  type MenuResult,
} from '@/modules/menu';

const ctx = (over: Partial<MenuContext> = {}): MenuContext => ({
  hook: { _id: 'h1' },
  lineUserId: 'U1',
  member: { id: 'm1', rawProfile: null, linked: false },
  siteRules: null,
  silence: { silenced: false, by: null },
  ...over,
});

const engineWith = (
  sources: MenuDefinitionSource[],
  send = jest.fn().mockResolvedValue({}),
) => ({
  send,
  engine: new MenuEngineService({
    sources,
    renderer: new FixedFlexRenderer(),
    coreSend: send,
  }),
});

const codeOnly = () => [new CodeRegistrySource()];

describe('[MENUENGINE] not ours ⇒ the webhook falls through', () => {
  it('⭐⭐⭐ plain text is handled:false and sends nothing', async () => {
    const { engine, send } = engineWith(codeOnly());
    expect(
      await engine.handleTap({
        text: 'สวัสดีครับ',
        replyToken: 'r',
        context: ctx(),
      }),
    ).toEqual({
      handled: false,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ a foreign postback (pay:/hoc:/menu:open) is handled:false', async () => {
    const { engine, send } = engineWith(codeOnly());
    for (const data of ['pay:resume:run-1:2', 'hoc:x', 'menu:open']) {
      expect(
        await engine.handlePostback({ data, replyToken: 'r', context: ctx() }),
      ).toEqual({
        handled: false,
      });
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe('[MENUENGINE] the happy path', () => {
  it('⭐⭐ a tap on an ENABLED scenario renders and sends one message', async () => {
    const { engine, send } = engineWith(codeOnly());
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({
      handled: true,
      action: 'sent',
      scenarioKey: 'primary',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [token, messages] = send.mock.calls[0];
    expect(token).toBe('rt');
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('flex');
  });

  it('⭐⭐ an `open` item opens the target menu (sub-menu chaining)', async () => {
    const { engine, send } = engineWith(codeOnly());
    const out = await engine.handlePostback({
      data: 'menu:v1:primary:open-sub',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.handled).toBe(true);
    /* primary/default's placeholder sub-target is second-a, which ships
       DISABLED — so the chain resolves and then refuses, silently. */
    expect(out.action).toBe('silent');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('[MENUENGINE] the silences', () => {
  it('⭐⭐⭐ silenced by the strike ceiling ⇒ handled + SILENT, nothing sent', async () => {
    const { engine, send } = engineWith(codeOnly());
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx({ silence: { silenced: true, by: 'ceiling' } }),
    });
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ silenced by an ADMIN block ⇒ handled + SILENT (same latch, different writer)', async () => {
    const { engine, send } = engineWith(codeOnly());
    const out = await engine.handleTap({
      text: '[[[menu-second]]]',
      replyToken: 'rt',
      context: ctx({ silence: { silenced: true, by: 'admin' } }),
    });
    expect(out.action).toBe('silent');
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ a DISABLED scenario never sends (every a-f placeholder today)', async () => {
    const { engine, send } = engineWith(codeOnly());
    for (const tag of ['[[[menu-primary-a]]]', '[[[menu-second-f]]]']) {
      const out = await engine.handleTap({
        text: tag,
        replyToken: 'rt',
        context: ctx(),
      });
      expect(out).toEqual({ handled: true, action: 'silent' });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('an unknown variant is silent, never a crash', async () => {
    const { engine, send } = engineWith(codeOnly());
    const out = await engine.handleTap({
      text: '[[[menu-primary-zzz]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('[MENUENGINE] every result kind reaches LINE in a valid shape', () => {
  /* The owner's rule: a scenario answers in ANY shape — text, flex, image — or
     chains into another menu. Only `text` was pinned before the 28/08
     backtest, so the image branch's preview fallback could be deleted and the
     suite stayed green: LINE rejects an image message whose previewImageUrl is
     undefined, and the failure would surface as a live send error. */
  const one = (result: MenuResult): MenuDefinition => ({
    key: 'primary-a',
    level: 'primary',
    variant: 'a',
    enabled: true,
    title: 't',
    items: [{ id: 'go', label: 'go', action: { type: 'result', result } }],
  });
  const only = (def: MenuDefinition): MenuDefinitionSource[] => [
    { get: () => def },
  ];

  const tap = async (result: MenuResult) => {
    const { engine, send } = engineWith(only(one(result)));
    const out = await engine.handlePostback({
      data: 'menu:v1:primary-a:go',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.action).toBe('sent');
    return send.mock.calls[0][1][0] as Record<string, unknown>;
  };

  it('⭐ text', async () => {
    expect(await tap({ kind: 'text', text: 'hello' })).toEqual({
      type: 'text',
      text: 'hello',
    });
  });

  it('⭐⭐ flex keeps altText and contents separate', async () => {
    expect(
      await tap({ kind: 'flex', flex: { type: 'bubble' }, altText: 'alt' }),
    ).toEqual({ type: 'flex', altText: 'alt', contents: { type: 'bubble' } });
  });

  it('⭐⭐⭐ image without a preview falls back to the image itself (LINE requires both)', async () => {
    expect(await tap({ kind: 'image', imageUrl: 'https://x/i.jpg' })).toEqual({
      type: 'image',
      originalContentUrl: 'https://x/i.jpg',
      previewImageUrl: 'https://x/i.jpg',
    });
  });

  it('⭐ an explicit preview is kept as given', async () => {
    expect(
      await tap({
        kind: 'image',
        imageUrl: 'https://x/i.jpg',
        previewUrl: 'https://x/p.jpg',
      }),
    ).toEqual({
      type: 'image',
      originalContentUrl: 'https://x/i.jpg',
      previewImageUrl: 'https://x/p.jpg',
    });
  });
});

describe('[MENUENGINE] the source chain — the dynamic seam (§3f)', () => {
  const stub = (
    key: string,
    over: Partial<MenuDefinition> = {},
  ): MenuDefinition => ({
    key,
    level: 'primary',
    variant: key === 'primary' ? null : key.slice('primary-'.length),
    enabled: true,
    title: `from-front ${key}`,
    items: [
      {
        id: 'x',
        label: 'x',
        action: { type: 'result', result: { kind: 'text', text: 'front' } },
      },
    ],
    ...over,
  });

  it('⭐⭐⭐ a front source WINS over the code registry (per-key override)', async () => {
    const front: MenuDefinitionSource = {
      get: (level, variant) =>
        level === 'primary' && variant === null ? stub('primary') : null,
    };
    const { engine, send } = engineWith([front, new CodeRegistrySource()]);
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.action).toBe('sent');
    expect(JSON.stringify(send.mock.calls[0][1])).toContain(
      'from-front primary',
    );
  });

  it('⭐⭐⭐ per-scenario independence: a front `{enabled:false}` stub disables ONE key while its neighbour still falls through to code', async () => {
    const front: MenuDefinitionSource = {
      get: (level, variant) =>
        level === 'primary' && variant === null
          ? stub('primary', { enabled: false }) // this hook turned it OFF
          : null, // everything else: inherit
    };
    const { engine, send } = engineWith([front, new CodeRegistrySource()]);

    const off = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(off).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();

    const inherited = await engine.handleTap({
      text: '[[[menu-second]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(inherited.action).toBe('sent');
    expect(inherited.scenarioKey).toBe('second');
    expect(JSON.stringify(send.mock.calls[0][1])).toContain(
      SCENARIOS.get('second')!.title,
    );
  });

  it('⭐ an async source is awaited (tomorrow’s DB-backed hook source)', async () => {
    const front: MenuDefinitionSource = {
      get: async () =>
        Promise.resolve(stub('primary', { title: 'async-front' })),
    };
    const { engine, send } = engineWith([front, new CodeRegistrySource()]);
    await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(JSON.stringify(send.mock.calls[0][1])).toContain('async-front');
  });
});

describe('[MENUENGINE] the send contract (§3c)', () => {
  it('⭐⭐⭐ a send failure THROWS through — a refused send must never look delivered', async () => {
    const send = jest.fn().mockRejectedValue(new Error('LINE said no'));
    const { engine } = engineWith(codeOnly(), send);
    await expect(
      engine.handleTap({
        text: '[[[menu-primary]]]',
        replyToken: 'rt',
        context: ctx(),
      }),
    ).rejects.toThrow('LINE said no');
  });

  it('⭐⭐⭐ the engine ANNOUNCES what it did — tap, postback, send, refused', async () => {
    /* 🔴 Why this is not decoration (plan §3g): for a POSTBACK the wlog row is
       the ONLY trace that anything happened — the chat room does not render
       postbacks at all. S3 wires these events to the existing wlog door; if the
       engine silently stopped emitting them, that wiring would faithfully write
       nothing and a whole class of customer action would vanish with no error.
       Found unpinned by the 28/08 re-dive: all four `safeLog` calls could be
       DELETED with the suite fully green. */
    const seen: Array<{ kind: string; scenarioKey?: string; detail?: string }> =
      [];
    const send = jest.fn().mockResolvedValue({});
    const engine = new MenuEngineService({
      sources: codeOnly(),
      renderer: new FixedFlexRenderer(),
      coreSend: send,
      log: (e) => seen.push(e),
    });

    await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(seen).toEqual([
      { kind: 'tap', scenarioKey: 'primary' },
      { kind: 'send', scenarioKey: 'primary' },
    ]);

    seen.length = 0;
    const item = SCENARIOS.get('primary')!.items[0]!;
    await engine.handlePostback({
      data: `menu:v1:primary:${item.id}`,
      replyToken: 'rt',
      context: ctx(),
    });
    expect(seen[0]).toEqual({ kind: 'postback', scenarioKey: 'primary' });
    expect(seen.map((e) => e.kind)).toContain('send');

    seen.length = 0;
    await engine.handleTap({
      text: '[[[menu-primary-zzz]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(seen).toEqual([
      { kind: 'tap', scenarioKey: 'primary-zzz' },
      { kind: 'refused', scenarioKey: 'primary-zzz', detail: 'silent' },
    ]);
  });

  it('⭐⭐ text that is not ours announces NOTHING — silence is the zero-impact contract', async () => {
    /* A log line for every unrelated message would turn a feature nobody
       triggered into noise on the busiest path in the system. */
    const seen: string[] = [];
    const engine = new MenuEngineService({
      sources: codeOnly(),
      renderer: new FixedFlexRenderer(),
      coreSend: jest.fn().mockResolvedValue({}),
      log: (e) => seen.push(e.kind),
    });
    await engine.handleTap({
      text: 'สวัสดีครับ',
      replyToken: 'rt',
      context: ctx(),
    });
    await engine.handlePostback({
      data: 'pay:resume:run-1:2',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(seen).toEqual([]);
  });

  it('⭐ a logging failure never fails the flow', async () => {
    const send = jest.fn().mockResolvedValue({});
    const engine = new MenuEngineService({
      sources: codeOnly(),
      renderer: new FixedFlexRenderer(),
      coreSend: send,
      log: () => {
        throw new Error('log sink down');
      },
    });
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.action).toBe('sent');
  });
});
