/**
 * [FEAT-20260828-MENUTAG-S2] the context assembler and the silence input.
 *
 * 🔴 THE MENU READS NO STRIKE DATA. The webhook's suspend gate runs far above
 * any menu seat (`webhook.service.ts:1321-1329`: `isSuspended` → log →
 * `return`), so a silenced customer's event never reaches the menu window
 * (`:1823`..`:3742`). A read here would duplicate a decision already made and
 * would require changing a module this feature does not own. `silence` is
 * therefore an INPUT the caller states.
 *
 * The model is ONE latch with attribution, not two flags: the schema has
 * `suspended_at` with `suspended_by`, and live rows agree (9 sessions, 5
 * silenced, 4 admin-armed). So `by` distinguishes WHO, never WHETHER.
 */
import {
  buildMenuContext,
  NOT_SILENCED,
  MenuEngineService,
  CodeRegistrySource,
  FixedFlexRenderer,
  type MenuSilenceState,
} from '@/modules/menu';

const input = {
  hook: { _id: 'h1' },
  lineUserId: 'U1',
  member: { id: 'm1', rawProfile: null, linked: false },
  siteRules: null,
};

describe('[MENUCONTEXT] the assembler', () => {
  it('⭐⭐⭐ omitting `silence` means NOT SILENCED — the upstream gate already returned', () => {
    expect(buildMenuContext(input).silence).toEqual(NOT_SILENCED);
  });

  it('⭐⭐ carries the latch and WHO armed it when the caller states one', () => {
    const since = new Date('2026-08-27T18:59:39.868Z');
    const ctx = buildMenuContext({
      ...input,
      silence: { silenced: true, by: 'admin', since },
    });
    expect(ctx.silence).toEqual({ silenced: true, by: 'admin', since });
  });

  it('⭐⭐ ceiling-armed and admin-armed are the SAME state, differing only in attribution', () => {
    const ceiling = buildMenuContext({
      ...input,
      silence: { silenced: true, by: 'ceiling' },
    });
    const admin = buildMenuContext({
      ...input,
      silence: { silenced: true, by: 'admin' },
    });
    expect(ceiling.silence.silenced).toBe(admin.silence.silenced);
    expect(ceiling.silence.by).not.toBe(admin.silence.by);
  });

  it('⭐ the rest of the bundle is passed through untouched', () => {
    const ctx = buildMenuContext(input);
    expect(ctx.hook).toBe(input.hook);
    expect(ctx.lineUserId).toBe('U1');
    expect(ctx.member).toBe(input.member);
    expect(ctx.siteRules).toBeNull();
  });
});

describe('[MENUCONTEXT] the engine honours the latch, whoever armed it', () => {
  const run = async (silence?: MenuSilenceState) => {
    const send = jest.fn().mockResolvedValue({});
    const engine = new MenuEngineService({
      sources: [new CodeRegistrySource()],
      renderer: new FixedFlexRenderer(),
      coreSend: send,
    });
    const out = await engine.handleTap({
      text: '[[[menu-primary]]]',
      replyToken: 'rt',
      context: buildMenuContext({ ...input, silence }),
    });
    return { out, send };
  };

  it('⭐⭐⭐ ceiling-armed ⇒ silent', async () => {
    const { out, send } = await run({ silenced: true, by: 'ceiling' });
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ admin-armed ⇒ silent', async () => {
    const { out, send } = await run({ silenced: true, by: 'admin' });
    expect(out).toEqual({ handled: true, action: 'silent' });
    expect(send).not.toHaveBeenCalled();
  });

  it('⭐⭐ not silenced ⇒ the menu answers', async () => {
    const { out, send } = await run();
    expect(out.action).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
