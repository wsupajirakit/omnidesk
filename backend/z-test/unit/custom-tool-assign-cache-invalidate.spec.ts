/* [FIX-20260812-ASSIGNCACHE] assign() ต้อง invalidate HOOK cache (ไม่ใช่แค่ tool cache)
 * ===========================================================================
 * บั๊ก: PUT /custom-tools/:id/assign เขียน hook.custom_tool_id/custom_tool_status
 * (field ที่ webhook อ่านทุก inbound) แต่เดิม invalidate แค่ tool cache ⇒ webhook
 * เสิร์ฟ hook ตัวเก่าจน TTL หมด — ตรงอาการ prod ลูกค้าทักไม่ได้ profile.
 * fix: loop invalidateHookCache(alias) ให้ hook ที่ added ∪ removed.
 *
 * เทสตรง: mock hookModel + spy hookCache → assert invalidateHookCache ถูกเรียก
 * ด้วย alias ของทุก hook ที่เปลี่ยน (link + unlink), ไม่ใช่แค่ tool cache.
 */
import { Types } from 'mongoose';
import { CustomToolsService } from '@/modules/hooks/custom-tools.service';

const TOOL_ID = new Types.ObjectId().toHexString();
const HOOK_A = new Types.ObjectId(); // จะถูก link (added)
const HOOK_B = new Types.ObjectId(); // ผูกอยู่ก่อน → ถูก unlink (removed)

// hookModel: findOne(tool), find(valid → [A]), find(custom_tool_id → [B]), updateMany x2
function makeService() {
  const invalidateHookCache = jest.fn().mockResolvedValue(undefined);
  const updateMany = jest
    .fn()
    .mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

  // find() ถูกเรียก 2 ครั้ง: ครั้งแรก = valid ids ([A]), ครั้งสอง = custom_tool_id ([B])
  let findCall = 0;
  const leanChain = (rows: unknown) => ({
    select: () => ({ lean: () => ({ exec: () => Promise.resolve(rows) }) }),
  });
  const hookModel = {
    find: jest.fn(() => {
      findCall += 1;
      return findCall === 1
        ? leanChain([{ _id: HOOK_A, alias: 'oa-alpha' }]) // valid hooks
        : leanChain([{ _id: HOOK_B, alias: 'oa-bravo' }]); // before-linked
    }),
    updateMany,
  };
  const customToolModel = {
    findOne: () => ({
      lean: () => ({
        exec: () => Promise.resolve({ _id: TOOL_ID, name: 'Shop-API' }),
      }),
    }),
  };
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const crypto = {};

  const svc = new CustomToolsService(
    customToolModel as never,
    hookModel as never,
    crypto as never,
    audit as never,
    { invalidateHookCache } as never,
  );
  return { svc, invalidateHookCache, updateMany };
}

describe('[FIX-20260812-ASSIGNCACHE] assign invalidates hook cache', () => {
  it('link + unlink → invalidateHookCache เรียกด้วย alias ของทั้ง added และ removed', async () => {
    const { svc, invalidateHookCache, updateMany } = makeService();

    await svc.assign(
      TOOL_ID,
      { hook_ids: [HOOK_A.toHexString()], activate: true },
      { userId: 'u1' } as never,
      {},
    );

    // เขียน 2 ครั้ง (unlink B, link A)
    expect(updateMany).toHaveBeenCalledTimes(2);
    // ⭐ invalidate ทั้ง added (oa-alpha) และ removed (oa-bravo)
    const aliases = invalidateHookCache.mock.calls.map((c) => c[0]);
    expect(aliases).toContain('oa-alpha');
    expect(aliases).toContain('oa-bravo');
  });
});
