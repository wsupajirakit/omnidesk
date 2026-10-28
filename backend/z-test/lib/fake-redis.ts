// [FEAT-20260808-QCACHE] In-memory fake of the ioredis surface the scoped query
// cache uses (get / set …EX / del / scan). Unit tests must NEVER open a real
// Redis socket — this is a hermetic, per-test store. It models only what the
// cache calls; anything else throws so an untested command can't silently pass.
//
// TTL is tracked but not auto-expired on a timer (tests are synchronous); a test
// that needs "expired" behaviour calls `advance(ms)`.

interface Entry {
  value: string;
  expiresAt: number | null;
}

export class FakeRedisClient {
  private store = new Map<string, Entry>();
  private now = 0;
  /** Every command seen, for asserting hit/miss/write counts. */
  public readonly calls: { cmd: string; key?: string }[] = [];

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && this.now >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  get(key: string): Promise<string | null> {
    this.calls.push({ cmd: 'get', key });
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  // Mirrors `client.set(key, value, 'EX', ttlSeconds)`.
  set(
    key: string,
    value: string,
    mode?: string,
    ttlSeconds?: number,
  ): Promise<'OK'> {
    this.calls.push({ cmd: 'set', key });
    const expiresAt =
      mode === 'EX' && typeof ttlSeconds === 'number'
        ? this.now + ttlSeconds * 1000
        : null;
    this.store.set(key, { value, expiresAt });
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      this.calls.push({ cmd: 'del', key });
      if (this.store.delete(key)) removed += 1;
    }
    return Promise.resolve(removed);
  }

  // Minimal SCAN: single pass, glob '*' suffix only (what invalidateScope uses).
  scan(
    _cursor: string,
    _match: 'MATCH',
    pattern: string,
  ): Promise<[string, string[]]> {
    this.calls.push({ cmd: 'scan' });
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    const keys = [...this.store.keys()].filter(
      (k) => this.live(k) && k.startsWith(prefix),
    );
    return Promise.resolve(['0', keys]);
  }

  /** Test helper: move the clock forward so TTL'd entries expire. */
  advance(ms: number): void {
    this.now += ms;
  }

  countGets(): number {
    return this.calls.filter((c) => c.cmd === 'get').length;
  }

  countSets(): number {
    return this.calls.filter((c) => c.cmd === 'set').length;
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

/** A `RedisService`-shaped stub exposing the fake client via getClient(). */
export function fakeRedisService(client: FakeRedisClient): {
  getClient: () => FakeRedisClient;
} {
  return { getClient: () => client };
}
