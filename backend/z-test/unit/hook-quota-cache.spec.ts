import { type LineQuotaApi } from '@/infra/line/api/line-quota';
import { type HookCacheService } from '@/modules/hooks/hook-cache.service';
import { HooksService } from '@/modules/hooks/hooks.service';

describe('LINE Quota Caching (5-minute Redis cache)', () => {
  it('serves quota from HookCacheService on cache hit without calling LineQuotaApi', async () => {
    const svc = Object.create(HooksService.prototype) as HooksService;
    const seat = svc as unknown as Record<string, unknown>;

    const cachedData = {
      quota: { type: 'limited', value: 1000 },
      consumption: { totalUsage: 350 },
      remaining: 650,
    };

    const mockHookCache = {
      getLineQuota: jest.fn().mockResolvedValue(cachedData),
      setLineQuota: jest.fn().mockResolvedValue(undefined),
    } as unknown as HookCacheService;

    const mockLineQuotaApi = {
      getQuotaSummary: jest.fn(),
    } as unknown as LineQuotaApi;

    seat['loadHookAccessToken'] = jest.fn().mockResolvedValue('token-123');
    seat['hookCache'] = mockHookCache;
    seat['lineQuotaApi'] = mockLineQuotaApi;

    const result = await svc.getHookQuota('hook-123');

    expect(result).toEqual(cachedData);
    expect(mockHookCache.getLineQuota).toHaveBeenCalledWith('hook-123');
    expect(mockLineQuotaApi.getQuotaSummary).not.toHaveBeenCalled();
    expect(mockHookCache.setLineQuota).not.toHaveBeenCalled();
  });

  it('fetches from LineQuotaApi on cache miss and writes to HookCacheService with 300s TTL', async () => {
    const svc = Object.create(HooksService.prototype) as HooksService;
    const seat = svc as unknown as Record<string, unknown>;

    const liveData = {
      ok: true,
      status: 200,
      quota: { type: 'limited', value: 500 },
      consumption: { totalUsage: 120 },
      remaining: 380,
    };

    const mockHookCache = {
      getLineQuota: jest.fn().mockResolvedValue(null),
      setLineQuota: jest.fn().mockResolvedValue(undefined),
    } as unknown as HookCacheService;

    const mockLineQuotaApi = {
      getQuotaSummary: jest.fn().mockResolvedValue(liveData),
    } as unknown as LineQuotaApi;

    seat['loadHookAccessToken'] = jest.fn().mockResolvedValue('token-123');
    seat['hookCache'] = mockHookCache;
    seat['lineQuotaApi'] = mockLineQuotaApi;

    const result = await svc.getHookQuota('hook-123');

    expect(result).toEqual({
      quota: liveData.quota,
      consumption: liveData.consumption,
      remaining: liveData.remaining,
    });
    expect(mockHookCache.getLineQuota).toHaveBeenCalledWith('hook-123');
    expect(mockLineQuotaApi.getQuotaSummary).toHaveBeenCalledWith('token-123');
    expect(mockHookCache.setLineQuota).toHaveBeenCalledWith(
      'hook-123',
      {
        quota: liveData.quota,
        consumption: liveData.consumption,
        remaining: liveData.remaining,
      },
      300,
    );
  });
});
