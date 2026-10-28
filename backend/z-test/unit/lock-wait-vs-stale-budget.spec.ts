/**
 * [CHAR-20260820-LOCKSTALE] characterization — the reply budget must survive the
 * longest a request can sit waiting for the per-user lock.
 *
 * NOTHING IS FIXED HERE, AND THAT IS DELIBERATE. This pins today's arithmetic so
 * that the next person to move one of these numbers is told, by a red test, what
 * the other one implies. It is a tripwire, not a behaviour test.
 *
 * ── WHAT WAS ACTUALLY MEASURED ───────────────────────────────────────────────
 * A widely-repeated description of this area says "the lock makes a customer's
 * message vanish". That is WRONG and this file records why: `withUserLock` runs
 * `actionFn` unconditionally after its wait loop — acquired or not — so the lock
 * only ever DELAYS work, it never drops it. lock ไม่เคยทิ้งงาน · มันแค่หน่วง.
 *
 * The suppression is somewhere else entirely: webhook.service.ts's staleness
 * guard drops a reply whose event is older than REPLY_STALE_MS, measured from
 * LINE's own `event.timestamp` — a clock that starts before we ever touch the
 * lock. So lock-wait time is spent INSIDE the budget.
 *
 * ── THE ARITHMETIC THIS PINS ─────────────────────────────────────────────────
 * The guard's own comment sizes the budget as "a 30s model call plus a 25s
 * assist budget = 55s, doubled". That sum never included the lock. A request can
 * wait up to `maxWaitTimeMs` in the Redis loop and again in the in-memory race,
 * so the true worst case is 2 x 25s + 55s = 105s against a 120s budget: fifteen
 * seconds of margin, not the sixty-five the comment implies.
 *
 * Fifteen seconds is not a bug today — no `Suppressed stale reply` line appears
 * in any log available here — so the owner's call was to leave the behaviour
 * alone and pin the numbers instead. If this test goes red, the margin has been
 * eaten by an edit somewhere and that edit needs a decision, not a bigger number.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { REPLY_STALE_MS } from '@/modules/webhook/webhook-routing';

const SERVICE = join(__dirname, '../../src/modules/webhook/webhook.service.ts');

/** Reads a `const <name> = <number>;` out of the service source. */
const constFromSource = (name: string): number => {
  const src = readFileSync(SERVICE, 'utf8');
  const m = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(src);
  if (!m)
    throw new Error(
      `${name} is no longer a numeric const in webhook.service.ts`,
    );
  return Number(m[1]);
};

/**
 * The guard's own stated budget for healthy work, from its comment: a 30s model
 * call plus a 25s assist budget. Kept as a literal because it is a statement
 * about intent, not a value the code reads.
 */
const HEALTHY_WORK_MS = 55_000;

describe('[CHAR-20260820-LOCKSTALE] lock wait is spent inside the reply budget', () => {
  it('the lock delays work and never drops it', () => {
    const src = readFileSync(SERVICE, 'utf8');
    // `actionFn()` is called from a plain try, not from inside a branch that
    // depends on whether the lock was acquired. If that ever changes, the
    // premise of this whole file changes with it.
    expect(src).toContain('return await actionFn();');
    expect(src).not.toMatch(/if\s*\(\s*!?redisAcquired\s*\)\s*\{\s*return\b/);
  });

  it('the worst lock wait still leaves the healthy budget inside REPLY_STALE_MS', () => {
    const maxWaitTimeMs = constFromSource('maxWaitTimeMs');
    // Two waits are reachable in one request: the Redis retry loop, then the
    // in-memory Promise.race that uses the same cap.
    const worstLockWaitMs = maxWaitTimeMs * 2;

    expect(worstLockWaitMs + HEALTHY_WORK_MS).toBeLessThan(REPLY_STALE_MS);
  });

  it('records the margin that exists today, so shrinking it is visible', () => {
    const maxWaitTimeMs = constFromSource('maxWaitTimeMs');
    const marginMs = REPLY_STALE_MS - (maxWaitTimeMs * 2 + HEALTHY_WORK_MS);

    // 15s as of 2026-08-20. This is the number the guard's comment does not
    // mention; if it drops, someone changed a budget without changing the other.
    expect(marginMs).toBe(15_000);
  });

  it('the lock timeout still outlives the work it guards', () => {
    // legacy raised this from 45s to 90s on 2026-07-28 because a 45s TTL expired
    // mid-request and let two requests run concurrently for one user.
    expect(constFromSource('lockTimeoutMs')).toBeGreaterThan(
      constFromSource('maxWaitTimeMs') * 2 + HEALTHY_WORK_MS - REPLY_STALE_MS,
    );
    expect(constFromSource('lockTimeoutMs')).toBe(90_000);
  });
});

/**
 * [PERF-20260824-LOCKBACKOFF] The retry gap grows; the WAIT WINDOW does not.
 *
 * The lock loop waits up to 25 s for another request from the same customer to
 * finish. With a fixed 150 ms gap that is ~166 `SET NX` round-trips per waiting
 * request, all of them asking the same question. Backoff makes the gap grow to a
 * ceiling and hold there.
 *
 * What these cases exist to protect is the part that must NOT have changed: the
 * window itself. `maxWaitTimeMs` and `lockTimeoutMs` are load-bearing for the
 * reply-token budget the rest of this file is about, and a backoff that quietly
 * widened either of them would move that budget without anyone noticing.
 *
 * The arithmetic case is the one that would catch a mistuned constant — a factor
 * of 1.0, or a ceiling equal to the start, both leave the loop polling as hard
 * as before while looking like they fixed it.
 */
describe('[LOCKBACKOFF] fewer Redis round-trips, same wait window', () => {
  const factorFromSource = (): number => {
    const src = readFileSync(SERVICE, 'utf8');
    const m = /const retryBackoffFactor\s*=\s*([\d.]+)/.exec(src);
    if (!m) throw new Error('retryBackoffFactor is no longer a numeric const');
    return Number(m[1]);
  };

  /** Replays the loop's own schedule and reports what it costs. */
  const schedule = (gapOf: (n: number) => number, windowMs: number) => {
    let elapsed = 0;
    let attempts = 0;
    let worstGap = 0;
    while (elapsed < windowMs && attempts < 10_000) {
      attempts += 1;
      const gap = gapOf(attempts);
      worstGap = Math.max(worstGap, gap);
      elapsed += gap;
    }
    return { attempts, worstGap };
  };

  it('⭐ (P1 PIN) the wait window is untouched — this is the whole safety property', () => {
    expect(constFromSource('maxWaitTimeMs')).toBe(25_000);
    expect(constFromSource('lockTimeoutMs')).toBe(90_000);

    const src = readFileSync(SERVICE, 'utf8');
    // the loop is still bounded by the window, not by an attempt count
    expect(src).toContain('while (Date.now() - startTime < maxWaitTimeMs)');
  });

  it('(P2 PIN) the FIRST retry is still timed exactly as before', () => {
    const src = readFileSync(SERVICE, 'utf8');
    expect(constFromSource('retryIntervalMs')).toBe(150);
    // the growing variable starts at the old fixed value
    expect(src).toContain('let retryWaitMs = retryIntervalMs;');
  });

  it('(T1) the loop sleeps on the growing value, not on the fixed one', () => {
    const src = readFileSync(SERVICE, 'utf8');
    expect(src).toContain('setTimeout(resolve, retryWaitMs)');
    expect(src).not.toContain('setTimeout(resolve, retryIntervalMs)');
  });

  it('(T2) the constants actually describe a backoff', () => {
    const start = constFromSource('retryIntervalMs');
    const ceiling = constFromSource('retryMaxIntervalMs');

    expect(factorFromSource()).toBeGreaterThan(1);
    expect(ceiling).toBeGreaterThan(start);
  });

  it('⭐ (T3) the round-trips per waiting request drop by several times over', () => {
    const window = constFromSource('maxWaitTimeMs');
    const start = constFromSource('retryIntervalMs');
    const ceiling = constFromSource('retryMaxIntervalMs');
    const factor = factorFromSource();

    const before = schedule(() => start, window);
    let gap = start;
    const after = schedule((n) => {
      if (n === 1) return start;
      gap = Math.min(Math.round(gap * factor), ceiling);
      return gap;
    }, window);

    // the old cost, for the record
    expect(before.attempts).toBeGreaterThan(150);
    // and the new one
    expect(after.attempts).toBeLessThan(before.attempts / 4);
    expect(after.attempts).toBeLessThanOrEqual(40);
  });

  it('(T4) no single gap can exceed the ceiling — the added latency is bounded', () => {
    const window = constFromSource('maxWaitTimeMs');
    const start = constFromSource('retryIntervalMs');
    const ceiling = constFromSource('retryMaxIntervalMs');
    const factor = factorFromSource();

    let gap = start;
    const after = schedule((n) => {
      if (n === 1) return start;
      gap = Math.min(Math.round(gap * factor), ceiling);
      return gap;
    }, window);

    expect(after.worstGap).toBeLessThanOrEqual(ceiling);
    // a waiter still notices a released lock inside one second
    expect(after.worstGap).toBeLessThanOrEqual(1_000);
  });
});
