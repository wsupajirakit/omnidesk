/** Remembers recently-seen values (signatures / nonces / refresh-token ids) for a TTL so a
 *  captured request cannot be replayed inside the accepted time window. Bounded in size. */
export class ReplayCache {
  readonly #seen = new Map<string, number>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 50_000,
  ) {}

  /** true = first time (accepted and remembered); false = replay. */
  claim(key: string, now = Date.now()): boolean {
    this.#sweep(now);
    if (this.#seen.has(key)) return false;
    if (this.#seen.size >= this.maxEntries) {
      const oldest = this.#seen.keys().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    this.#seen.set(key, now + this.ttlMs);
    return true;
  }

  #sweep(now: number): void {
    for (const [k, exp] of this.#seen) {
      if (exp > now) break; // insertion order = expiry order
      this.#seen.delete(k);
    }
  }
}
