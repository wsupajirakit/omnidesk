/**
 * [TEST-20260813-P2-HOOKLOAD] "hook โหลดถูก" — the two new columns survive the
 * cache, which is how the webhook actually reads a hook.
 *
 * ⚠️ The fullflow spec feeds the hook straight into the service, so it proves
 *    the flow but NOT the load. In production the webhook reads through
 *    `HookCacheService`, which serialises to JSON for L1 and Redis. The design
 *    claim was "CachedHook is Record<string, unknown> + .lean() + JSON, so new
 *    columns flow automatically and no cache change is needed". That claim was
 *    reasoned about, never executed. This runs it.
 *    ที่บอกว่า cache ไม่ต้องแก้ — ต้องรันให้เห็น ไม่ใช่เชื่อเหตุผล
 *
 * No Redis: the client is stubbed, so only the in-process path runs, which is
 * the one that does the JSON normalisation.
 */

import { HookCacheService } from '@/modules/hooks/hook-cache.service';

/** Redis stub — an in-memory string store, enough for the L2 round-trip. */
function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    set: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve('OK');
    },
    setex: (k: string, _ttl: number, v: string) => {
      store.set(k, v);
      return Promise.resolve('OK');
    },
    del: (k: string) => {
      store.delete(k);
      return Promise.resolve(1);
    },
    publish: () => Promise.resolve(0),
    subscribe: () => Promise.resolve(0),
    on: () => undefined,
    duplicate: () => client,
    quit: () => Promise.resolve('OK'),
  };
  return { client, store };
}

function buildCache(hookRow: Record<string, unknown> | null) {
  const { client, store } = fakeRedis();
  const hookModel = {
    findOne: () => ({
      lean: () => ({ exec: () => Promise.resolve(hookRow) }),
      exec: () => Promise.resolve(hookRow),
    }),
  };
  /* ⚠️ RedisService.publish is a method on the SERVICE, not on the client
     (`hook-cache.service.ts:210`). Omitting it does not fail the test — the
     cache catches and logs "cacheHook failed", so the write-through case passes
     while nothing was cached. Found by reading the log the run printed.
     stub ขาดเมธอด = เทสต์ผ่านทั้งที่ของไม่ทำงาน */
  const published: unknown[] = [];
  const service = new HookCacheService(
    hookModel as never,
    {
      getClient: () => client,
      publish: (...args: unknown[]) => {
        published.push(args);
        return Promise.resolve();
      },
    } as never,
    { redisTtlSeconds: 60, l1TtlMs: 5000 },
    { wsEnv: 'test' } as never,
    { encryptionKey: 'test-key-for-namespace-only' } as never,
  );
  return { service, store, published };
}

const HOOK_DS = {
  _id: 'hook-p2-load',
  alias: 'p2-load-oa',
  status: 1,
  ai_vendor: 'deepseek',
  ai_model: 'deepseek-reasoner',
  gemini_top_k: 20,
};

describe('[P2 HOOK LOAD] the vendor columns survive the cache untouched', () => {
  it('⭐ a DB read caches and returns ai_vendor + ai_model', async () => {
    const { service } = buildCache(HOOK_DS);
    const hook = await service.getHookByAlias('p2-load-oa');
    expect(hook?.['ai_vendor']).toBe('deepseek');
    expect(hook?.['ai_model']).toBe('deepseek-reasoner');
  });

  it('⭐ the SECOND read (served from L1, not the DB) still carries both', async () => {
    /* This is the one that matters: L1 hands back a normalised JSON copy, so a
       column the normaliser dropped would look right on the first read and
       vanish on every subsequent one — an OA that answers with the wrong vendor
       only after the cache warms. อ่านครั้งสองคือของจริง */
    const { service } = buildCache(HOOK_DS);
    await service.getHookByAlias('p2-load-oa');
    const second = await service.getHookByAlias('p2-load-oa');
    expect(second?.['ai_vendor']).toBe('deepseek');
    expect(second?.['ai_model']).toBe('deepseek-reasoner');
  });

  it('a write-through cacheHook keeps them too (the dashboard-save path)', async () => {
    const { service } = buildCache(null);
    await service.cacheHook({
      ...HOOK_DS,
      ai_vendor: 'gemini',
      ai_model: null,
    });
    const hook = await service.getHookByAlias('p2-load-oa');
    expect(hook?.['ai_vendor']).toBe('gemini');
    // null must stay null, not become undefined — the BE reads null as
    // "use the vendor's family default", and undefined would too, but the
    // dashboard shows the difference.
    expect(hook?.['ai_model']).toBeNull();
  });

  it('an old row with neither column loads fine — nothing to migrate', async () => {
    const { service } = buildCache({
      _id: 'legacy',
      alias: 'p2-load-oa',
      status: 1,
      gemini_top_k: 20,
    });
    const hook = await service.getHookByAlias('p2-load-oa');
    expect(hook).toBeTruthy();
    expect(hook?.['ai_vendor']).toBeUndefined();
    // and the knobs beside them are unaffected
    expect(hook?.['gemini_top_k']).toBe(20);
  });

  it('the cached payload really is JSON — the columns are inside the stored string', async () => {
    // Belt and braces: proves the assertions above are reading a serialised
    // copy rather than the same object handed back by reference.
    const { service, store } = buildCache(HOOK_DS);
    await service.getHookByAlias('p2-load-oa');
    /* ⚠️ No `if (stored)` guard: wrapping the assertions in one makes the case
       pass silently when nothing was ever cached, which is exactly the failure
       it is supposed to catch. Assert the store is non-empty FIRST. */
    const stored = Array.from(store.values()).join('');
    expect(stored.length).toBeGreaterThan(0);
    expect(stored).toContain('deepseek');
    expect(stored).toContain('deepseek-reasoner');
  });
});
