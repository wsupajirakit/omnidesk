/**
 * [FEAT-20260822-BCASTRESUME] Carrying on after a restart.
 * ===========================================================================
 * 🔵 MOST OF THIS FILE TESTS A RESERVED PIPE — READ THIS BEFORE TRUSTING IT.
 *
 * `buildAudienceCursor` and `canResendChunk` have ZERO callers in `src/`. The
 * owner decided on 23/08 that automatically continuing a stopped run is not
 * required; a stopped run is sent again from the beginning. They are kept
 * because that decision is cheap to reverse (see `resume.ts`'s header for the
 * three things still missing), not because anything runs them.
 *
 * ⚠️ SO A GREEN RUN HERE PROVES THE SHAPES ARE RIGHT, NOT THAT RESUMING WORKS.
 *    An audit traced part of why two live-path defects survived — a cursor
 *    walking past unsent people, and one retry key covering two different
 *    groups — to reviewer attention spent on this suite while the live path
 *    drifted underneath it. The live behaviour is covered by
 *    `broadcast-run-executor.spec.ts`; look there first when something is wrong
 *    with an actual send.
 *    เขียวที่นี่ = รูปทรงถูก ไม่ได้แปลว่าฟีเจอร์ทำงาน — ของจริงอยู่ที่ run-executor spec.
 *
 * `FRESH_RESUME` and `advanceResume` ARE live and are used on every run.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FRESH_RESUME,
  advanceResume,
  buildAudienceCursor,
  canResendChunk,
} from '@/modules/content';

const base = { hook_ids: 'h1', flag: true };

describe('resume — forward only, and no copy of the audience', () => {
  it('a fresh run asks for the audience from the beginning', () => {
    const c = buildAudienceCursor(base, FRESH_RESUME('h1'), 500);
    expect(c?.filter).toEqual(base);
    expect(c?.sort).toEqual({ _id: 1 });
    expect(c?.limit).toBe(500);
  });

  it('🔴 always sorts — without an order, "after X" means nothing', () => {
    const c = buildAudienceCursor(
      base,
      { hookId: 'h1', afterId: 'm9', nextChunkIndex: 3 },
      500,
    );
    expect(c?.sort).toEqual({ _id: 1 });
  });

  it('a resumed run asks only for what is past the cursor', () => {
    const c = buildAudienceCursor(
      base,
      { hookId: 'h1', afterId: 'm500', nextChunkIndex: 1 },
      500,
    );
    expect(c?.filter['_id']).toEqual({ $gt: 'm500' });
    expect(c?.filter['flag']).toBe(true); // the rules still apply
  });

  it('🔴 the cursor moves ONLY after a chunk was accepted', () => {
    // Advancing on a failure would step over 500 people and nothing would ever
    // come back for them.
    const p = FRESH_RESUME('h1');
    expect(advanceResume(p, '').afterId).toBeNull();
    const after = advanceResume(p, 'm500');
    expect(after.afterId).toBe('m500');
    expect(after.nextChunkIndex).toBe(1);
  });

  it('the chunk index keeps counting, because the retry key is built from it', () => {
    let p = FRESH_RESUME('h1');
    p = advanceResume(p, 'm500');
    p = advanceResume(p, 'm1000');
    expect(p.nextChunkIndex).toBe(2);
    expect(p.afterId).toBe('m1000');
  });

  it('🔴 a chunk may only be resent when it still has its original key', () => {
    // A fresh key would make LINE treat the repeat as a new request and the
    // customer would receive it twice.
    expect(canResendChunk('run1:h1:7')).toBe(true);
    expect(canResendChunk(null)).toBe(false);
    expect(canResendChunk('')).toBe(false);
  });

  it('refuses to build a cursor it cannot make deterministic', () => {
    expect(buildAudienceCursor(base, FRESH_RESUME('h1'), 0)).toBeNull();
    expect(
      buildAudienceCursor(base, FRESH_RESUME('h1'), Number.NaN),
    ).toBeNull();
    expect(
      buildAudienceCursor(
        null as unknown as Record<string, unknown>,
        FRESH_RESUME('h1'),
        500,
      ),
    ).toBeNull();
  });

  it('does not mutate the point it was given', () => {
    const p = FRESH_RESUME('h1');
    advanceResume(p, 'm500');
    expect(p.afterId).toBeNull();
    expect(p.nextChunkIndex).toBe(0);
  });
});

describe('🔵 the reserved half really is unwired — a canary, not a wish', () => {
  it('nothing in src/ calls the reserved exports', () => {
    /* If this ever goes red, somebody wired the pipe — which is fine, but the
       header above and `resume.ts`'sthree-step list must be updated in the same
       change, or the next reader is told the opposite of the truth.
       ถ้าแดง แปลว่ามีคนต่อท่อแล้ว ⇒ ต้องมาแก้คำอธิบายพร้อมกัน. */
    const hits = execSync(
      "grep -rl 'buildAudienceCursor\\|canResendChunk' --include='*.ts' src/ || true",
      { cwd: join(__dirname, '..', '..'), encoding: 'utf8' },
    )
      .split('\n')
      .filter((f) => f && !f.endsWith('resume.ts') && !f.endsWith('index.ts'));

    expect(hits).toEqual([]);
  });

  it('the live cursor is built somewhere else entirely', () => {
    // `withCursor` in the pager is what a real run uses.
    const pager = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src/modules/content/broadcast-send/adapters/recipient.pager.ts',
      ),
      'utf8',
    );
    expect(pager).toMatch(/export function withCursor/);
    expect(pager).not.toMatch(/buildAudienceCursor/);
  });
});
