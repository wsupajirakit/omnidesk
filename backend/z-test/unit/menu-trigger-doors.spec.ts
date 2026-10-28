/**
 * [FEAT-20260828-MENUTAG-S1] the trigger doors — tag / postback, each on its own.
 *
 * Owner, 28/08: "เลือกได้ ตั้งค่าได้ใน code ง่าย ๆ ว่าอ่าน tag menu ไหม หรือ
 * trigger แค่ postback อย่างเดียวก็ได้ ยืดหยุ่นห้ามพัง".
 *
 * The rule that makes "ห้ามพัง" true: a CLOSED door answers `handled:false` —
 * byte-identical to "this text/payload was never ours" — so the webhook falls
 * through exactly as it does today. Closing a door removes the menu from that
 * path; it never adds a branch to it.
 *
 * Also pinned here: a postback must RESOLVE ITS SCENARIO for real — the id in
 * the payload is looked up in the registry, its item is found, and its action
 * is performed. A postback that "parses" but resolves nothing would be a menu
 * that answers taps and dies on every button.
 */
import {
  MenuEngineService,
  CodeRegistrySource,
  FixedFlexRenderer,
  buildMenuPostback,
  MENU_TRIGGERS,
  SCENARIOS,
  type MenuContext,
  type MenuDefinition,
  type MenuDefinitionSource,
  type MenuTriggerConfig,
} from '@/modules/menu';

const ctx = (): MenuContext => ({
  hook: { _id: 'h1' },
  lineUserId: 'U1',
  member: { id: 'm1', rawProfile: null, linked: false },
  siteRules: null,
  silence: { silenced: false, by: null },
});

const build = (
  triggers?: MenuTriggerConfig,
  sources?: MenuDefinitionSource[],
) => {
  const send = jest.fn().mockResolvedValue({});
  return {
    send,
    engine: new MenuEngineService({
      sources: sources ?? [new CodeRegistrySource()],
      renderer: new FixedFlexRenderer(),
      coreSend: send,
      triggers,
    }),
  };
};

/** An enabled definition whose items exercise both action kinds. */
const enabledPrimary: MenuDefinition = {
  key: 'primary',
  level: 'primary',
  variant: null,
  enabled: true,
  title: 'live primary',
  items: [
    {
      id: 'say-hi',
      label: 'hi',
      action: { type: 'result', result: { kind: 'text', text: 'HI' } },
    },
    { id: 'go-sub', label: 'sub', action: { type: 'open', target: 'second' } },
  ],
};
const liveSource: MenuDefinitionSource = {
  get: (level, variant) =>
    level === 'primary' && variant === null ? enabledPrimary : null,
};

describe('[MENUDOORS] the shipped default', () => {
  it('both doors are open by default', () => {
    expect(MENU_TRIGGERS).toEqual({ tag: true, postback: true });
  });
});

describe('[MENUDOORS] tag OFF, postback ON — menus open only from a button', () => {
  const triggers: MenuTriggerConfig = { tag: false, postback: true };

  it('⭐⭐⭐ typing the tag does NOTHING and is handled:false — the webhook flows on', async () => {
    const { engine, send } = build(triggers);
    expect(
      await engine.handleTap({
        text: '[[[menu-primary]]]',
        replyToken: 'rt',
        context: ctx(),
      }),
    ).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ a postback still works — same closed-door run', async () => {
    const { engine, send } = build(triggers, [
      liveSource,
      new CodeRegistrySource(),
    ]);
    const out = await engine.handlePostback({
      data: buildMenuPostback('primary', 'say-hi'),
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({
      handled: true,
      action: 'sent',
      scenarioKey: 'primary',
    });
    expect(send.mock.calls[0][1]).toEqual([{ type: 'text', text: 'HI' }]);
  });
});

describe('[MENUDOORS] postback OFF, tag ON', () => {
  const triggers: MenuTriggerConfig = { tag: true, postback: false };

  it('⭐⭐⭐ a menu postback is handled:false — it reaches whoever handles it next', async () => {
    const { engine, send } = build(triggers, [
      liveSource,
      new CodeRegistrySource(),
    ]);
    expect(
      await engine.handlePostback({
        data: buildMenuPostback('primary', 'say-hi'),
        replyToken: 'rt',
        context: ctx(),
      }),
    ).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐ the tag door still opens menus', async () => {
    const { engine, send } = build(triggers, [
      liveSource,
      new CodeRegistrySource(),
    ]);
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out.action).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('[MENUDOORS] both OFF — the module is inert while still wired', () => {
  it('⭐⭐⭐ every input is handled:false and nothing is sent', async () => {
    const { engine, send } = build({ tag: false, postback: false }, [
      liveSource,
    ]);
    expect(
      await engine.handleTap({
        text: '[[[menu-primary]]]',
        replyToken: 'rt',
        context: ctx(),
      }),
    ).toEqual({ handled: false });
    expect(
      await engine.handlePostback({
        data: buildMenuPostback('primary', 'say-hi'),
        replyToken: 'rt',
        context: ctx(),
      }),
    ).toEqual({ handled: false });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('[MENUDOORS] a postback RESOLVES its scenario for real', () => {
  it('⭐⭐⭐ the payload’s scenario is looked up, its item found, its result sent', async () => {
    const { engine, send } = build(undefined, [
      liveSource,
      new CodeRegistrySource(),
    ]);
    await engine.handlePostback({
      data: buildMenuPostback('primary', 'say-hi'),
      replyToken: 'rt',
      context: ctx(),
    });
    expect(send.mock.calls[0][1]).toEqual([{ type: 'text', text: 'HI' }]);
  });

  it('⭐⭐⭐ an `open` item resolves the TARGET scenario and renders THAT menu', async () => {
    const { engine, send } = build(undefined, [
      liveSource,
      new CodeRegistrySource(),
    ]);
    const out = await engine.handlePostback({
      data: buildMenuPostback('primary', 'go-sub'),
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({
      handled: true,
      action: 'sent',
      scenarioKey: 'second',
    });
    /* proof it rendered the TARGET, not the menu the button lived on */
    expect(JSON.stringify(send.mock.calls[0][1])).toContain(
      SCENARIOS.get('second')!.title,
    );
  });

  it('⭐⭐ an item id that no longer exists is refused silently, never a crash', async () => {
    const { engine, send } = build(undefined, [
      liveSource,
      new CodeRegistrySource(),
    ]);
    const out = await engine.handlePostback({
      data: buildMenuPostback('primary', 'removed-item'),
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐ a postback naming a DISABLED scenario is refused silently', async () => {
    const { engine, send } = build(undefined, [new CodeRegistrySource()]);
    const out = await engine.handlePostback({
      data: buildMenuPostback('primary-a', 'item-1'),
      replyToken: 'rt',
      context: ctx(),
    });
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });
});
