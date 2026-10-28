import { Test } from '@nestjs/testing';

import { rateLimitConfig, realtimeConfig } from '@/config/app.config';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { RedisService } from '@/infra/redis/redis.service';

/**
 * Rate limiting protects against abuse but must never become an availability
 * risk of its own — these tests pin the fail-open behaviour that guarantees a
 * Redis outage cannot lock every operator out of login.
 */
describe('RateLimitService', () => {
  const redisStub = { incrementWithTtl: jest.fn(), getCount: jest.fn() };

  const config = {
    globalEnabled: false,
    globalMax: 600,
    globalWindowSeconds: 60,
    defaultMax: 3,
    defaultWindowSeconds: 30,
    loginMax: 10,
    loginWindowSeconds: 300,
    keyMax: 60,
    keyWindowSeconds: 60,
  };

  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RateLimitService,
        { provide: RedisService, useValue: redisStub },
        { provide: rateLimitConfig.KEY, useValue: config },
        // The service namespaces its Redis keys by environment so dev traffic
        // cannot consume production's window.
        { provide: realtimeConfig.KEY, useValue: { wsEnv: 'test' } },
      ],
    }).compile();

    return moduleRef.get(RateLimitService);
  };

  beforeEach(() => {
    redisStub.incrementWithTtl.mockReset();
    redisStub.getCount.mockReset();
  });

  it('allows requests up to the limit and blocks the one past it', async () => {
    const service = await build();

    redisStub.incrementWithTtl.mockResolvedValueOnce(3);
    await expect(service.consume('default', '10.0.0.1')).resolves.toMatchObject(
      {
        limited: false,
        current: 3,
        limit: 3,
      },
    );

    redisStub.incrementWithTtl.mockResolvedValueOnce(4);
    await expect(service.consume('default', '10.0.0.1')).resolves.toMatchObject(
      {
        limited: true,
        current: 4,
      },
    );
  });

  it('applies the per-bucket window and limit', async () => {
    const service = await build();
    redisStub.incrementWithTtl.mockResolvedValue(1);

    await service.consume('login', 'user-1');

    // The environment segment is part of the key: without it, a failed login on
    // dev would consume production's window for everyone behind the same IP.
    expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
      'ratelimit:test:login:user-1',
      config.loginWindowSeconds,
    );
  });

  /* [FEAT-20260821-RATELADDER] a caller may hand in its own limit/window for
     one call — the per-user ladder escalates a customer's window without the
     limiter learning what a "level" is. The key gets a suffix so the escalated
     window never shares a counter with the base one. No override = unchanged. */
  describe("override (the ladder's door)", () => {
    it('uses the given limit + window and suffixes the key', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(2);
      const v = await service.consume('default', 'U1', {
        limit: 1,
        windowSeconds: 60,
        keySuffix: 'L2',
      });
      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
        'ratelimit:test:default:U1:L2',
        60,
      );
      expect(v).toMatchObject({
        limited: true,
        current: 2,
        limit: 1,
        windowSeconds: 60,
      });
    });

    it('no override → the exact key and limits as before (byte-identical path)', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(1);
      await service.consume('default', 'U1');
      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
        'ratelimit:test:default:U1',
        config.defaultWindowSeconds,
      );
    });
  });

  it('fails open when redis is unreachable', async () => {
    const service = await build();
    // null is how RedisService reports "command failed".
    redisStub.incrementWithTtl.mockResolvedValueOnce(null);

    await expect(service.consume('login', 'user-1')).resolves.toMatchObject({
      limited: false,
      current: null,
    });
  });

  it('ignores empty identifiers rather than sharing one bucket', async () => {
    const service = await build();

    await expect(service.consume('default', '')).resolves.toMatchObject({
      limited: false,
    });
    expect(redisStub.incrementWithTtl).not.toHaveBeenCalled();
  });

  /**
   * [FEAT-20260824-RATEPEEK] `peek` — `consume` without the charge.
   *
   * The first case is the one that matters: peek and consume must read and write
   * THE SAME KEY. `buildKey` exists precisely because a second spelling of that
   * string would let two layers count different things, and the comment on it
   * says so. Asserting the two agree is what keeps that true after this method
   * was added — a peek pointed at the wrong key would report a window nobody is
   * counting, and the caller would skip work for no reason.
   */
  describe('[RATEPEEK] the read-only twin', () => {
    it('⭐ reads EXACTLY the key consume writes — no second spelling', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(1);
      await service.consume('default', 'U1');
      const written = String(redisStub.incrementWithTtl.mock.calls[0]![0]);

      redisStub.getCount.mockResolvedValueOnce(1);
      await service.peek('default', 'U1');
      const read = String(redisStub.getCount.mock.calls[0]![0]);

      expect(read).toBe(written);
    });

    it('⭐ never increments — the counter belongs to consume alone', async () => {
      const service = await build();
      redisStub.getCount.mockResolvedValueOnce(5);

      await service.peek('default', 'U1');

      expect(redisStub.incrementWithTtl).not.toHaveBeenCalled();
      expect(redisStub.getCount).toHaveBeenCalledTimes(1);
    });

    it('reports limited when the counter is already past the limit', async () => {
      const service = await build();
      redisStub.getCount.mockResolvedValueOnce(4); // defaultMax is 3
      await expect(service.peek('default', 'U1')).resolves.toMatchObject({
        limited: true,
        current: 4,
        limit: 3,
      });
    });

    it('AT the limit it says NOT limited — the conservative reading, on purpose', async () => {
      const service = await build();
      // `current > limit`, matching consume. A caller deciding whether to skip
      // paid work must not skip on the boundary: being wrong there would drop a
      // request that is still inside its quota.
      redisStub.getCount.mockResolvedValueOnce(3);
      await expect(service.peek('default', 'U1')).resolves.toMatchObject({
        limited: false,
        current: 3,
      });
    });

    it('fails OPEN when Redis answers null — same rule consume has', async () => {
      const service = await build();
      redisStub.getCount.mockResolvedValueOnce(null);
      await expect(service.peek('default', 'U1')).resolves.toMatchObject({
        limited: false,
        current: null,
      });
    });

    it('an empty identifier never reaches Redis', async () => {
      const service = await build();
      await expect(service.peek('default', '')).resolves.toMatchObject({
        limited: false,
      });
      expect(redisStub.getCount).not.toHaveBeenCalled();
    });

    it("honours the ladder's override, like consume does", async () => {
      const service = await build();
      redisStub.getCount.mockResolvedValueOnce(2);
      await expect(
        service.peek('default', 'U1', { limit: 1, windowSeconds: 60 }),
      ).resolves.toMatchObject({ limited: true, limit: 1, windowSeconds: 60 });
    });
  });
});
