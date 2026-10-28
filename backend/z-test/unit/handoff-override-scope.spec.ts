/**
 * [FIX-20260818-HANDOFFSCOPE] plan §8 = T3-3 of fix_plan_18_aug · closes audit C2.4
 *
 * `POST /handoff/overrides` upserts the row that decides WHERE an OA's handoff
 * traffic is sent and WITH WHICH credential. It read `hook_id` from the request
 * body and checked nothing, so an operator could point another OA's outbound
 * calls at an endpoint of their choosing — the highest-value write in the module.
 *
 * The module already owned a correct three-tier check (`HandoffOaAccessService`),
 * so the fix is to CALL it rather than to write a fourth spelling of the rule.
 * These cases pin that the gate runs before the row is touched: the override
 * model must never see a write from a caller who was refused.
 */
import { HandoffChainService } from '@/modules/handoff';

const OA_A = 'a0d000000000000000000043';
const OA_B = 'a0d000000000000000000044';

const buildService = (allowed: string[] | null) => {
  const updateOne = jest.fn().mockResolvedValue({});
  // the real call chains `.lean().exec()` — stub the shape the code uses
  const findOneAndUpdate = jest.fn(() => ({
    lean: () => ({ exec: () => Promise.resolve({ _id: 'ov1' }) }),
  }));
  const overrideModel = {
    updateOne,
    findOneAndUpdate,
    findOne: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
  };
  /** The real access service, fed a Hook model that answers the group tier. */
  const oaAccess = {
    ensureHookAccess: async (_user: unknown, hookId: unknown) => {
      if (allowed === null) return;
      if (!allowed.includes(String(hookId))) {
        const { ForbiddenException } = await import('@nestjs/common');
        throw new ForbiddenException('insufficient OA access');
      }
    },
  };
  const service = new HandoffChainService(
    {} as never,
    {} as never,
    overrideModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { encrypt: (v: string) => `enc:${v}` } as never,
    oaAccess as never,
  );
  return { service, updateOne, findOneAndUpdate };
};

describe('[HANDOFFSCOPE] an override may only be written for your own OA', () => {
  const body = (hookId: string) => ({
    hook_id: hookId,
    target_key: 'pay_topup',
    endpoint_url: 'https://attacker.example/collect',
  });

  it('⭐ another OA is refused BEFORE the row is touched', async () => {
    const { service, updateOne, findOneAndUpdate } = buildService([OA_A]);

    await expect(
      service.upsertOverride(body(OA_B), {} as never),
    ).rejects.toThrow();

    // the whole point: nothing was written on the way to the refusal
    expect(updateOne).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('the caller’s own OA still writes — unchanged', async () => {
    const { service } = buildService([OA_A]);
    await expect(
      service.upsertOverride(body(OA_A), {} as never),
    ).resolves.toBeDefined();
  });

  it('a super user writes for any OA, as before', async () => {
    const { service } = buildService(null);
    await expect(
      service.upsertOverride(body(OA_B), {} as never),
    ).resolves.toBeDefined();
  });
});
