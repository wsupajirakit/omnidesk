/* [FEAT-20260815-LINEQUOTA] the arithmetic behind the quota dialog
 * ===========================================================================
 * These cases exist because every one of them is a way to tell the operator
 * something false about how many messages they may still send:
 *   · an unlimited plan rendered as 0/0  → "you are out" when they are not
 *   · usage above the cap                → a bar wider than its track
 *   · a missing field                    → NaN on screen
 */
import { describe, it, expect } from 'vitest';
import { readQuota } from '../components/hook/quota/useHookQuota';
import type { HookQuotaResponse } from '../types';

const res = (over: Partial<HookQuotaResponse>): HookQuotaResponse => ({
  quota: { type: 'limited', value: 200 },
  consumption: { totalUsage: 120 },
  remaining: 80,
  ...over,
});

describe('[LINEQUOTA] readQuota', () => {
  it('reads a normal limited plan — 120/200, 80 left, 60%', () => {
    const q = readQuota(res({}));
    expect(q).toMatchObject({ unlimited: false, used: 120, limit: 200, remaining: 80, percent: 60 });
  });

  /* type:'none' is LINE's way of saying "no cap". It carries no `value`, so a
     naive Number(undefined) would put NaN on the operator's screen. */
  it('treats type:"none" as UNLIMITED — no limit, no percentage', () => {
    const q = readQuota(res({ quota: { type: 'none' }, remaining: null }));
    expect(q.unlimited).toBe(true);
    expect(q.limit).toBeNull();
    expect(q.remaining).toBeNull();
    expect(q.percent).toBe(0);
    expect(q.used).toBe(120); // usage is still real and still worth showing
  });

  it('clamps a bar that would overflow when usage exceeds the cap', () => {
    const q = readQuota(res({ consumption: { totalUsage: 260 } }));
    expect(q.percent).toBe(100);
    expect(q.used).toBe(260);
  });

  it('never divides by zero when the cap is 0', () => {
    const q = readQuota(res({ quota: { type: 'limited', value: 0 } }));
    expect(q.percent).toBe(0);
    expect(Number.isFinite(q.percent)).toBe(true);
  });

  it('survives null and half-filled payloads instead of rendering NaN', () => {
    expect(readQuota(null)).toMatchObject({ used: 0, limit: null, percent: 0 });
    const partial = readQuota({ quota: {} as any, consumption: {} as any, remaining: null });
    expect(partial.used).toBe(0);
    expect(partial.percent).toBe(0);
  });
});
