/**
 * [FEAT-20260822-BCASTGUARDS] The guards that stop this feature's three known
 * risks from turning into silent debt.
 * ===========================================================================
 * Each `describe` below exists because something in the design is only safe
 * WHILE a promise holds. A promise nobody checks is not a promise, so each one
 * is checked here instead of being written in a comment and hoped for.
 * ทุกข้อในนี้คือ "คำสัญญาที่ถูกบังคับ" ไม่ใช่ "คำสัญญาที่เขียนไว้เฉย ๆ".
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MONGO_MAX_POOL_MIRROR,
  P99_MS,
  P99_PROVENANCE,
  RUN_TIME_ALLOWANCE_SEC,
  SERVER_RESERVE,
  computeMaxRequests,
  p99DriftRatio,
  p99NeedsRemeasure,
} from '@/modules/content';

const repoRoot = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * Read a spec with every comment removed.
 *
 * ⚠️ WHY this exists — a guard that greps raw text is a guard that a comment can
 * satisfy. The first version of the import check below matched
 * `/^\s*import[\s\S]{0,200}?from '@\/modules\/webhook'/m`, and a mutation test
 * walked straight through it: the lazy span started at a REAL import, ran past
 * its `;`, and landed on `@/modules/webhook` sitting inside a commented-out
 * line. Green, with the true import deleted.
 *
 * That is the same mistake the standalone gate made in §D31 (it false-positived
 * on a comment naming `flex-render.util.ts`). Twice is a pattern, so the fix is
 * structural rather than a smarter regex: delete comments first, then refuse to
 * cross a `;` — one import statement cannot span two statements.
 * ตัดคอมเมนต์ก่อนค่อย match · ห้าม regex ข้าม `;` ไปหยิบข้อความจากบรรทัดอื่น.
 */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\n'"`]*\/\/.*$/gm, (line) =>
      line.slice(0, line.indexOf('//')),
    );

/* ── RISK 1 ─────────────────────────────────────────────────────────────────
 * The cloned var spec + formatter (D38) are only safe while their two drift
 * specs exist AND actually run. This guard activates itself the moment the
 * clone appears, so the clone cannot land without them.
 */
describe('risk 1 — a clone may not exist without the guard that holds it', () => {
  const CLONE_DIR = 'src/modules/content/broadcast-var/spec';
  const FORMAT_DIR = 'src/modules/content/broadcast-var/format';
  const SPEC_DRIFT = 'z-test/unit/broadcast-var-spec-drift.spec.ts';
  const FORMAT_DRIFT = 'z-test/unit/broadcast-var-format-drift.spec.ts';

  /**
   * ⚠️ Each check below reads the filesystem for ITSELF.
   *
   * An earlier version built a `REQUIRED` list from `cloneExists ? [x] : []`
   * and then asserted the list contained `x` — which cannot fail once
   * `cloneExists` is true. An independent reviewer caught it, and it is exactly
   * the vacuous-green this whole file exists to forbid. Deriving the
   * expectation from the same condition you are testing proves nothing.
   * อย่าเอาเงื่อนไขเดียวกันมาสร้างทั้งคำถามและคำตอบ.
   */
  const exists = (rel: string) => existsSync(join(repoRoot, rel));

  /* ⚠️ The `if (!exists(dir)) return …` escape hatches these two used to carry
     were dead: both clones exist on this branch, so that arm never ran and was
     unreachable code sitting inside a test. A reviewer flagged it. The clones
     ARE here, so the check is unconditional — and if somebody deletes one, the
     first assertion is what says so. โค้ดที่ไม่มีวันถูกรัน ไม่ควรอยู่ในเทส. */
  it('🔴 a cloned spec table implies its drift spec on disk', () => {
    expect(exists(CLONE_DIR)).toBe(true);
    expect(exists(SPEC_DRIFT)).toBe(true);
  });

  it('🔴 a cloned formatter implies its value-drift spec on disk', () => {
    expect(exists(FORMAT_DIR)).toBe(true);
    expect(exists(FORMAT_DRIFT)).toBe(true);
  });

  it('🔴 neither drift spec may be skipped', () => {
    for (const spec of [SPEC_DRIFT, FORMAT_DRIFT].filter(exists)) {
      const src = readCode(spec);
      expect(src).not.toMatch(/\b(describe|it|test)\.(skip|only|todo)\b/);
      expect(src).not.toMatch(/\bx(describe|it)\b/);
    }
  });

  it('🔴 neither drift spec may be gutted down to a token assertion', () => {
    // The old check was `toMatch(/expect\(/)`, which a file reduced to a single
    // `expect(true).toBe(true)` would pass. Real comparisons come in numbers.
    for (const spec of [SPEC_DRIFT, FORMAT_DRIFT].filter(exists)) {
      const src = readCode(spec);
      const assertions = src.match(/\bexpect\s*\(/g) ?? [];
      expect(assertions.length).toBeGreaterThanOrEqual(8);
      expect(src).not.toMatch(/expect\(true\)\.toBe\(true\)/);
    }
  });

  it('🔴 each drift spec really IMPORTS upstream — a comment does not count', () => {
    // `[^;]*` is the load-bearing part: it stops the match from running out of
    // one import statement and into text that belongs to another line. Paired
    // with readCode(), a commented-out import can no longer satisfy this.
    const upstream = /^\s*import[^;]*?from\s+'@\/modules\/(webhook|system)'/m;
    for (const spec of [SPEC_DRIFT, FORMAT_DRIFT].filter(exists)) {
      expect(readCode(spec)).toMatch(upstream);
    }
  });

  it('🔴 each drift spec compares against something, not just imports it', () => {
    for (const spec of [SPEC_DRIFT, FORMAT_DRIFT].filter(exists)) {
      const src = readCode(spec);
      expect(src).toMatch(/toEqual\(/);
    }
  });
});

/* ── RISK 2 ─────────────────────────────────────────────────────────────────
 * `MONGO_MAX_POOL_MIRROR` is a copy of a number that lives somewhere else. A
 * copy nobody compares is a lie waiting to happen, so this compares it.
 */
describe('risk 2 — the pool mirror must equal the real pool setting', () => {
  it('matches maxPoolSize in infra/mongo/mongo.module.ts', () => {
    const src = read('src/infra/mongo/mongo.module.ts');
    const m = src.match(/maxPoolSize:\s*([0-9_]+)/);
    // If this fails, the setting moved or was renamed — find it before trusting
    // any reserve calculated from the mirror.
    expect(m).not.toBeNull();
    const real = Number(String(m?.[1]).replace(/_/g, ''));
    expect(real).toBe(MONGO_MAX_POOL_MIRROR);
  });
});

/* ── RISK 3 ─────────────────────────────────────────────────────────────────
 * Every ceiling is computed from P99_MS, which was measured on a dev machine.
 * The number now carries its own provenance and can report its own staleness.
 */
describe('risk 3 — the ceiling numbers must declare where they came from', () => {
  it('carries provenance that is USABLE, not just present', () => {
    /* ⚠️ REWRITTEN. The old version asserted `source` contained the literal
       'webhook_logs' typed into this file — a change-detector with no
       independent source of truth, which a reviewer called out. The question
       worth asking is not "does the string match?" but "could somebody
       re-measure this number from what it tells them?".
       provenance ที่ re-measure ตามไม่ได้ = ไม่ใช่ provenance. */

    // 1. a sample small enough to be noise makes a p99 meaningless
    expect(P99_PROVENANCE.sampleSize).toBeGreaterThanOrEqual(100);

    // 2. the source must name a collection that actually exists in this repo
    const collection = P99_PROVENANCE.source.split('·')[0]?.trim() ?? '';
    expect(collection.length).toBeGreaterThan(0);
    expect(
      existsSync(
        join(repoRoot, 'src/modules/system/schemas/webhook-log.schema.ts'),
      ),
    ).toBe(true);
    expect(read('src/modules/system/schemas/webhook-log.schema.ts')).toContain(
      collection,
    );

    // 3. a measurement with no date cannot be judged stale
    expect(P99_PROVENANCE.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(['dev', 'stg', 'prod']).toContain(P99_PROVENANCE.environment);

    /* 4. and the ceiling actually derives from it — provenance on a number
          nothing uses would be decoration. */
    expect(
      computeMaxRequests(P99_MS, RUN_TIME_ALLOWANCE_SEC, SERVER_RESERVE),
    ).toBeGreaterThan(0);
  });

  it('detects when reality has drifted away from the configured number', () => {
    expect(p99DriftRatio(1223)).toBeCloseTo(0);
    expect(p99DriftRatio(2446)).toBeCloseTo(1); // twice as slow
    expect(p99NeedsRemeasure(1300)).toBe(false); // within tolerance
    expect(p99NeedsRemeasure(2000)).toBe(true); // ceilings are now optimistic
    expect(p99NeedsRemeasure(600)).toBe(true); // ceilings are now too tight
  });

  it('never divides by a nonsense observation', () => {
    expect(p99DriftRatio(0)).toBe(0);
    expect(p99DriftRatio(Number.NaN)).toBe(0);
    expect(p99NeedsRemeasure(0)).toBe(false);
  });
});
