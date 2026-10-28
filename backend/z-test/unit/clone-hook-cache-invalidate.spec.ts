/* [FIX-20260812-CLONECACHE] cloneHookSettings() ต้อง invalidate hook cache ของ target
 * ===========================================================================
 * บั๊ก: clone เขียน field ที่ webhook อ่าน (flex_custom_ids, custom_tool_id, ฯลฯ)
 * ให้ target hook แต่เดิม **ไม่บอก HookCacheService** ⇒ webhook เสิร์ฟ target ตัวเก่า
 * จน TTL หมด (L1 15วิ / L2 12ชม). fix: invalidateHookCache(target.alias) หลัง updateOne
 * เฉพาะ target ที่เขียนจริง (changed>0).
 *
 * mount HooksService จริง + mock hookModel/audit + spy hookCache → assert
 * invalidateHookCache ถูกเรียกด้วย alias ของ target ที่ clone.
 */
import { Types } from 'mongoose';
import { HooksService } from '@/modules/hooks/hooks.service';

const SOURCE_ID = new Types.ObjectId().toHexString();
const TARGET_ID = new Types.ObjectId().toHexString();

function makeService() {
  const invalidateHookCache = jest.fn().mockResolvedValue(undefined);

  // source มี custom_tool_id (tab external_api) ต่างจาก target → clone เขียน (changed>0)
  const TOOL = new Types.ObjectId().toHexString();
  const source: Record<string, unknown> = {
    _id: SOURCE_ID,
    alias: 'src-oa',
    group: 'g1',
    custom_tool_id: TOOL,
    custom_tool_status: true,
  };
  const target: Record<string, unknown> = {
    _id: TARGET_ID,
    alias: 'tgt-oa',
    group: 'g1',
    custom_tool_id: null,
    custom_tool_status: false, // ต่างจาก source ⇒ changed
  };

  const findById = jest.fn((id: string) => ({
    lean: () => ({
      exec: () => Promise.resolve(String(id) === SOURCE_ID ? source : target),
    }),
    select: () => ({
      lean: () => ({
        exec: () => Promise.resolve(String(id) === SOURCE_ID ? source : target),
      }),
    }),
    exec: () => Promise.resolve(String(id) === SOURCE_ID ? source : target),
  }));
  const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const hookModel = { findById, updateOne };

  // audit: proxy คืน no-op function ทุก method ที่ clone เรียก (write/createAuditLog/...)
  const auditLog = new Proxy(
    {},
    { get: () => jest.fn(() => ({ catch: () => {} })) },
  );

  const svc = new HooksService(
    hookModel as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never, // group/flex/user/crypto
    {
      invalidateHookCache,
      cacheHook: jest.fn().mockResolvedValue(undefined),
    } as never, // hookCache
    auditLog as never,
    {} as never,
    {} as never,
    {} as never, // credentialCheck/customTools/handoffBindings
    /* [PHASE3-I-QUOTA] LineQuotaApi — clone never reaches the quota path. */
    {} as never,
  );
  // ปิด ensureGroupAccess (superadmin flow) เพื่อไม่ให้ throw
  (svc as unknown as Record<string, unknown>).ensureGroupAccess = () => {};
  return { svc, invalidateHookCache, updateOne };
}

describe('[FIX-20260812-CLONECACHE] clone invalidates target hook cache', () => {
  it('clone → invalidateHookCache เรียกด้วย alias ของ target ที่เขียนจริง', async () => {
    const { svc, invalidateHookCache, updateOne } = makeService();

    await svc.cloneHookSettings(
      SOURCE_ID,
      {
        target_ids: [TARGET_ID],
        tabs: ['external_api'],
        confirm: true,
      },
      // [FIX-20260818-HOOKWRITESCOPE] `roleName`, not `role` — the guard reads
      // `AuthenticatedUser.roleName` (common/auth/super-role.ts:5). The old key
      // never matched, which went unnoticed while `ensureGroupAccess` was stubbed
      // out; the allowlist tier is a free function and cannot be.
      {
        user: {
          username: 'dev',
          roleName: 'superadmin',
          permissions: ['system.manage'],
        },
      } as never,
    );

    expect(updateOne).toHaveBeenCalled();
    // ⭐ invalidate ด้วย alias ของ target
    const aliases = invalidateHookCache.mock.calls.map((c) => c[0]);
    expect(aliases).toContain('tgt-oa');
  });
});
