import { type LineQuotaApi } from '@/infra/line/api/line-quota';
import { type HookCacheService } from '@/modules/hooks/hook-cache.service';
import { HooksService } from '@/modules/hooks/hooks.service';

describe('LINE Followers Insight Caching & Fallback (5-minute Redis cache)', () => {
  it('serves insight followers from HookCacheService on cache hit without calling LineQuotaApi', async () => {
    const svc = Object.create(HooksService.prototype) as HooksService;
    const seat = svc as unknown as Record<string, unknown>;

    const cachedData = {
      status: 'ready',
      followers: 1200,
      targetedReaches: 1050,
      blocks: 150,
    };

    const mockHookCache = {
      getLineFollowers: jest.fn().mockResolvedValue(cachedData),
      setLineFollowers: jest.fn().mockResolvedValue(undefined),
    } as unknown as HookCacheService;

    const mockLineQuotaApi = {
      getInsightFollowers: jest.fn(),
    } as unknown as LineQuotaApi;

    seat['loadHookAccessToken'] = jest.fn().mockResolvedValue('token-123');
    seat['hookCache'] = mockHookCache;
    seat['lineQuotaApi'] = mockLineQuotaApi;
    seat['logger'] = { warn: jest.fn() };

    const result = await svc.getHookFollowers('hook-123');

    expect(result).toEqual(cachedData);
    expect(mockHookCache.getLineFollowers).toHaveBeenCalledWith('hook-123');
    expect(mockLineQuotaApi.getInsightFollowers).not.toHaveBeenCalled();
    expect(mockHookCache.setLineFollowers).not.toHaveBeenCalled();
  });

  it('fetches from LineQuotaApi on cache miss and writes to HookCacheService with 300s TTL', async () => {
    const svc = Object.create(HooksService.prototype) as HooksService;
    const seat = svc as unknown as Record<string, unknown>;

    const liveData = {
      ok: true,
      status: 200,
      data: {
        status: 'ready',
        followers: 1500,
        targetedReaches: 1300,
        blocks: 200,
      },
    };

    const mockHookCache = {
      getLineFollowers: jest.fn().mockResolvedValue(null),
      setLineFollowers: jest.fn().mockResolvedValue(undefined),
    } as unknown as HookCacheService;

    const mockLineQuotaApi = {
      getInsightFollowers: jest.fn().mockResolvedValue(liveData),
    } as unknown as LineQuotaApi;

    seat['loadHookAccessToken'] = jest.fn().mockResolvedValue('token-123');
    seat['hookCache'] = mockHookCache;
    seat['lineQuotaApi'] = mockLineQuotaApi;
    seat['logger'] = { warn: jest.fn() };

    const result = await svc.getHookFollowers('hook-123');

    expect(result).toEqual({
      status: 'ready',
      followers: 1500,
      targetedReaches: 1300,
      blocks: 200,
    });
    expect(mockHookCache.getLineFollowers).toHaveBeenCalledWith('hook-123');
    expect(mockLineQuotaApi.getInsightFollowers).toHaveBeenCalled();
    expect(mockHookCache.setLineFollowers).toHaveBeenCalledWith(
      'hook-123',
      {
        status: 'ready',
        followers: 1500,
        targetedReaches: 1300,
        blocks: 200,
      },
      300,
    );
  });

  it('handles LINE API failure gracefully without throwing and caches unavailable fallback', async () => {
    const svc = Object.create(HooksService.prototype) as HooksService;
    const seat = svc as unknown as Record<string, unknown>;

    const failData = {
      ok: false,
      status: 400,
      reason: 'Invalid date or unready',
    };

    const mockHookCache = {
      getLineFollowers: jest.fn().mockResolvedValue(null),
      setLineFollowers: jest.fn().mockResolvedValue(undefined),
    } as unknown as HookCacheService;

    const mockLineQuotaApi = {
      getInsightFollowers: jest.fn().mockResolvedValue(failData),
    } as unknown as LineQuotaApi;

    seat['loadHookAccessToken'] = jest.fn().mockResolvedValue('token-123');
    seat['hookCache'] = mockHookCache;
    seat['lineQuotaApi'] = mockLineQuotaApi;
    seat['logger'] = { warn: jest.fn() };

    const result = await svc.getHookFollowers('hook-123');

    expect(result).toEqual({
      status: 'unavailable',
      followers: null,
      targetedReaches: null,
      blocks: null,
    });
    expect(mockHookCache.setLineFollowers).toHaveBeenCalledWith(
      'hook-123',
      {
        status: 'unavailable',
        followers: null,
        targetedReaches: null,
        blocks: null,
      },
      300,
    );
  });
});
