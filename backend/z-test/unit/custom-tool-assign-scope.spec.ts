/* [FIX-20260815-ASSIGNSCOPE] assign() must not touch custom_tool_id for money tools
 * ===========================================================================
 * A hook wires three tools through three SEPARATE fields, one per job:
 *
 *   custom_tool_id   → profile / site-rules / customer-link
 *   payment_tool_id  → topup      (payment-runner.service.ts:611)
 *   walletpay_tool_id   → walletpay leg (payment-runner.service.ts:1435)
 *
 * The Custom Tools page writes only the FIRST one, for every tool, as a REPLACE.
 * So saving the walletpay tool re-pointed all seven OAs' `custom_tool_id` at it,
 * and saving Shop-API took them back — the numbers flipped 7/0 ↔ 0/7 on every save
 * (observed live on 15/08, four consecutive DB reads).
 *
 * ⚠️ THE REAL DAMAGE IS NOT THE COUNTER. `webhook.service.ts:1429` resolves the
 * customer profile through `getToolForHook`, which reads `custom_tool_id`. Point
 * that field at the walletpay tool — which has no `is_profile` endpoint — and the
 * webhook silently loses customerName / customerTel / contractCode. The owner
 * reported it as "perm มันหายจริง"; this is the mechanism.
 *
 * THE RULE THIS PINS: only a `generic` tool may claim `custom_tool_id`. Payment
 * and walletpay tools are bound on the hook edit screen, through their own fields,
 * which is where they already are and where they belong.
 *
 * NOT CHANGED: a generic tool assigns exactly as before — same REPLACE, same
 * unlink, same cache invalidation. `payment_tool_id` / `walletpay_tool_id` are not
 * written here at all, so no money binding moves.
 */
import { Types } from 'mongoose';

// eslint-disable-next-line no-restricted-imports
import { CustomToolsService } from '@/modules/hooks/custom-tools.service';

const TOOL_ID = new Types.ObjectId().toHexString();
const HOOK_A = new Types.ObjectId();

const META = { ip: '127.0.0.1', user_agent: 'test' } as never;
const USER = { _id: new Types.ObjectId(), username: 'tester' } as never;

/** `category` decides whether the write is allowed to happen at all. */
function makeService(category: string) {
  const updateMany = jest
    .fn()
    .mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

  let findCall = 0;
  const leanChain = (rows: unknown) => ({
    select: () => ({ lean: () => ({ exec: () => Promise.resolve(rows) }) }),
  });
  const hookModel = {
    find: jest.fn(() => {
      findCall += 1;
      // 1st: validate requested ids · 2nd: hooks currently linked to this tool
      return findCall === 1
        ? leanChain([{ _id: HOOK_A, alias: 'oa-alpha' }])
        : leanChain([]);
    }),
    updateMany,
  };
  const customToolModel = {
    findOne: () => ({
      lean: () => ({
        exec: () =>
          Promise.resolve({ _id: TOOL_ID, name: `tool-${category}`, category }),
      }),
    }),
  };

  const svc = new CustomToolsService(
    customToolModel as never,
    hookModel as never,
    {} as never,
    { write: jest.fn().mockResolvedValue(undefined) } as never,
    { invalidateHookCache: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { svc, updateMany };
}

/** Every `$set` payload that reached the DB, flattened. */
const writtenFields = (updateMany: jest.Mock): string[] =>
  updateMany.mock.calls.flatMap((call) =>
    Object.keys((call[1] as { $set?: Record<string, unknown> })?.$set ?? {}),
  );

describe('[ASSIGNSCOPE] only a generic tool may claim custom_tool_id', () => {
  it('a generic tool still links exactly as before', async () => {
    const { svc, updateMany } = makeService('generic');

    await svc.assign(TOOL_ID, { hook_ids: [String(HOOK_A)] }, USER, META);

    expect(updateMany).toHaveBeenCalled();
    expect(writtenFields(updateMany)).toContain('custom_tool_id');
  });

  /* The two cases that stop the profile path from being hijacked — each money
     tool claims ITS OWN field and leaves `custom_tool_id` alone. */
  it('a payment tool writes payment_tool_id, never custom_tool_id', async () => {
    const { svc, updateMany } = makeService('payment');

    await svc.assign(TOOL_ID, { hook_ids: [String(HOOK_A)] }, USER, META);

    const fields = writtenFields(updateMany);
    expect(fields).toContain('payment_tool_id');
    expect(fields).not.toContain('custom_tool_id');
    expect(fields).not.toContain('walletpay_tool_id');
  });

  it('a walletpay tool writes walletpay_tool_id, never custom_tool_id', async () => {
    const { svc, updateMany } = makeService('walletpay');

    await svc.assign(TOOL_ID, { hook_ids: [String(HOOK_A)] }, USER, META);

    const fields = writtenFields(updateMany);
    expect(fields).toContain('walletpay_tool_id');
    expect(fields).not.toContain('custom_tool_id');
    expect(fields).not.toContain('payment_tool_id');
  });

  /* The whole point: two tools, one OA, no contest. Before the split both wrote
     `custom_tool_id`, so whichever was saved last took the OA from the other —
     the 7/0 ↔ 0/7 flip the owner watched happen. */
  it('the three categories never write the same field', async () => {
    const written: Record<string, string[]> = {};
    for (const category of ['generic', 'payment', 'walletpay']) {
      const { svc, updateMany } = makeService(category);
      await svc.assign(TOOL_ID, { hook_ids: [String(HOOK_A)] }, USER, META);
      written[category] = writtenFields(updateMany).filter((f) =>
        f.endsWith('_tool_id'),
      );
    }
    expect(written['generic']).toEqual(['custom_tool_id']);
    expect(written['payment']).toEqual(['payment_tool_id']);
    expect(written['walletpay']).toEqual(['walletpay_tool_id']);
  });

  /* The status switch must follow its own id — pairing `walletpay_tool_id` with
     `custom_tool_status` would turn a binding on that nothing reads. */
  it('each category flips its OWN status switch when activating', async () => {
    const { svc, updateMany } = makeService('walletpay');

    await svc.assign(
      TOOL_ID,
      { hook_ids: [String(HOOK_A)], activate: true },
      USER,
      META,
    );

    const fields = writtenFields(updateMany);
    expect(fields).toContain('walletpay_tool_status');
    expect(fields).not.toContain('custom_tool_status');
  });
});
