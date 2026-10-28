/**
 * [FEAT-20260829-MENUCHAIN] the `result: { kind: 'menu' }` branch.
 *
 * ── WHY THIS SPEC EXISTS ────────────────────────────────────────────────────
 * `MenuResult` has four members and the 28/08 backtest pinned three of them.
 * The fourth — a result that OPENS another menu — was the only branch in
 * `sendResult` with no coverage (`menu-engine.service.ts`, the `kind === 'menu'`
 * branch). It is also the only one that RE-ENTERS the engine, so it is the one
 * where a mistake compounds instead of staying local.
 *
 * No shipped scenario uses it today (0 occurrences under `scenarios/`); every
 * one chains with `action: { type: 'open' }` instead, which is a different code
 * path and is already covered. But `kind: 'menu'` is a shipped member of a
 * PUBLIC union, so whoever writes the real content (Q6) can reach it — and an
 * untested branch that only a future author can trigger is the worst kind.
 *
 * ── WHAT WAS CHECKED AND DELIBERATELY NOT GUARDED ───────────────────────────
 * Traced for unbounded recursion before writing anything: `sendResult` can call
 * `open()`, but `open()` only resolves → renders → sends. It never calls
 * `sendResult`. So the chain is `result:menu → open → send. stop.` — depth is
 * bounded at one hop by construction, and a self-referential target sends that
 * menu once rather than looping.
 *
 * Therefore NO recursion guard was written: the input it would defend against
 * cannot occur (owner's rule — guard only what can happen). The last case below
 * pins that fact, so if `open()` ever gains a `sendResult` call the assumption
 * fails loudly here instead of hanging a worker in production.
 */
import {
  MenuEngineService,
  FixedFlexRenderer,
  type MenuContext,
  type MenuDefinition,
  type MenuDefinitionSource,
} from '@/modules/menu';

const ctx = (): MenuContext => ({
  hook: { group: 'g' },
  lineUserId: 'U1',
  member: null,
  siteRules: null,
  silence: { silenced: false, by: null },
});

/** `primary` chains to `second` via a RESULT (not via an `open` action). */
const primary = (open: string): MenuDefinition => ({
  key: 'primary',
  level: 'primary',
  variant: null,
  enabled: true,
  title: 'หลัก',
  items: [
    {
      id: 'go',
      label: 'ไปเมนูรอง',
      action: { type: 'result', result: { kind: 'menu', open } },
    },
  ],
});

const second = (over: Partial<MenuDefinition> = {}): MenuDefinition => ({
  key: 'second',
  level: 'second',
  variant: null,
  enabled: true,
  title: 'เมนูรอง',
  items: [
    {
      id: 'x',
      label: 'x',
      action: { type: 'result', result: { kind: 'text', text: 'x' } },
    },
  ],
  ...over,
});

const engineWith = (defs: MenuDefinition[]) => {
  const send = jest.fn().mockResolvedValue({});
  const logs: { kind: string; scenarioKey?: string }[] = [];
  const sources: MenuDefinitionSource[] = [
    {
      get: (level, variant) =>
        defs.find((d) => d.level === level && d.variant === variant) ?? null,
    },
  ];
  const engine = new MenuEngineService({
    sources,
    renderer: new FixedFlexRenderer(),
    coreSend: send,
    log: (e) => logs.push(e),
  });
  return { engine, send, logs };
};

const press = (engine: MenuEngineService, data = 'menu:v1:primary:go') =>
  engine.handlePostback({ data, replyToken: 'rt', context: ctx() });

describe('[MENUCHAIN] a result that opens another menu', () => {
  it('⭐ sends the TARGET menu, not the one that was pressed', async () => {
    const { engine, send } = engineWith([primary('second'), second()]);
    const out = await press(engine);
    expect(out.action).toBe('sent');
    expect(out.scenarioKey).toBe('second');
    const msg = send.mock.calls[0][1][0] as Record<string, unknown>;
    expect(msg['altText']).toBe('เมนูรอง');
  });

  it('sends exactly ONE message — the chain is not both menus', async () => {
    const { engine, send } = engineWith([primary('second'), second()]);
    await press(engine);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses an unparseable target instead of sending something wrong', async () => {
    const { engine, send } = engineWith([
      primary('not a scenario key'),
      second(),
    ]);
    const out = await press(engine);
    expect(out.handled).toBe(true);
    expect(out.action).not.toBe('sent');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses when the target does not exist', async () => {
    const { engine, send } = engineWith([primary('second-f')]);
    const out = await press(engine);
    expect(out.action).not.toBe('sent');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses when the target exists but is DISABLED', async () => {
    const { engine, send } = engineWith([
      primary('second'),
      second({ enabled: false }),
    ]);
    const out = await press(engine);
    expect(out.action).not.toBe('sent');
    expect(send).not.toHaveBeenCalled();
  });

  it('logs the send under the TARGET key, so the trace shows what the customer saw', async () => {
    const { engine, logs } = engineWith([primary('second'), second()]);
    await press(engine);
    expect(
      logs.filter((l) => l.kind === 'send').map((l) => l.scenarioKey),
    ).toEqual(['second']);
  });

  it('⭐⭐ a self-referential target sends ONCE and stops — no unbounded recursion', async () => {
    /* `open()` renders and sends; it never calls `sendResult`, so the hop is
       bounded by construction. If that ever changes this test hangs or fails
       rather than a production worker spinning. */
    const selfOpen: MenuDefinition = {
      ...primary('primary'),
      items: [
        {
          id: 'go',
          label: 'วน',
          action: { type: 'result', result: { kind: 'menu', open: 'primary' } },
        },
      ],
    };
    const { engine, send } = engineWith([selfOpen]);
    const out = await press(engine);
    expect(out.action).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('[MENUCHAIN] a postback arriving while the room is silenced', () => {
  it('is handled but sends nothing', async () => {
    const send = jest.fn().mockResolvedValue({});
    const engine = new MenuEngineService({
      sources: [{ get: () => second() }],
      renderer: new FixedFlexRenderer(),
      coreSend: send,
    });
    const out = await engine.handlePostback({
      data: 'menu:v1:second:x',
      replyToken: 'rt',
      context: {
        ...ctx(),
        silence: { silenced: true, by: 'admin' },
      },
    });
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });
});
