/**
 * [FIX-20260823-BCASTRULES] The conditions actually reach the sender.
 * ===========================================================================
 * 🔴 FOUND BY A REAL SCHEDULED SEND, NOT BY A TEST. A job carrying a rule for
 *    three named people targeted ALL SIXTEEN members of the OA, because the
 *    conditions were dropped at three separate layers and nothing noticed:
 *
 *      1. `BroadcastTargetDto` named only `mode` / `group_ids`, so the pipe
 *         removed `match` and `rules` before the handler ran
 *      2. `normalizeTarget` rebuilt the object field by field and kept neither
 *      3. `audienceFor` read `mode` and returned "everyone" regardless
 *
 *    Each layer is the same silent-drop shape that has now cost this feature
 *    three separate columns. `matched: 0` in every history row was the fact
 *    saying so, and nothing read it.
 *    ทุกชั้นประกอบ object ใหม่ทีละฟิลด์ = อะไรไม่อยู่ในลิสต์ก็หายเงียบ.
 *
 * 🔴 AND THE FAILURE DIRECTION IS THE DANGEROUS ONE: a dropped condition makes
 *    the audience WIDER than the admin asked for. There is no undo once the
 *    messages are out. เงื่อนไขหาย = ยิงกว้างกว่าที่สั่ง.
 */
import { ValidationPipe } from '@nestjs/common';

import {
  BroadcastTargetDto,
  CreateBroadcastDto,
  audienceFor,
  ensureValidDescription,
  who,
} from '@/modules/content';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const through = (body: unknown, metatype: unknown): Promise<unknown> =>
  pipe.transform(body, { type: 'body', metatype: metatype as never });

const RULE = { key: 'display_name', op: 'in', value: ['bbbb', 'tttdev'] };

describe('layer 1 — the pipe lets the conditions through', () => {
  it('🔴 `rules` survives on the nested target', async () => {
    const out = (await through(
      { mode: 'all', group_ids: [], match: 'or', rules: [RULE] },
      BroadcastTargetDto,
    )) as Record<string, unknown>;
    expect(out['rules']).toEqual([RULE]);
    expect(out['match']).toBe('or');
  });

  it('🔴 and on a whole create body — the nested DTO is what strips it', async () => {
    const out = (await through(
      {
        name: 'promo',
        description: 'why this exists',
        hook_ids: ['a0d000000000000000000029'],
        message: { type: 'text', text: 'hi' },
        target: { mode: 'all', group_ids: [], match: 'or', rules: [RULE] },
      },
      CreateBroadcastDto,
    )) as Record<string, unknown>;
    const target = out['target'] as Record<string, unknown>;
    expect(target['rules']).toEqual([RULE]);
  });
});

describe('layer 3 — the sender READS them', () => {
  it('🔴 a stored rule reaches the audience query', () => {
    const q = audienceFor({ mode: 'all', rules: [RULE], match: 'or' });
    expect(q).toEqual({ match: 'or', rules: [RULE] });
  });

  it('🔴 no rules still means everyone — that is a real answer', () => {
    /* A campaign to every follower is a normal thing to want. What changed is
       that a NON-empty list is no longer thrown away. */
    expect(audienceFor({ mode: 'all' })).toEqual({ match: 'and', rules: [] });
    expect(audienceFor(undefined)).toEqual({ match: 'and', rules: [] });
  });

  it('`and` is the default — the stricter of the two', () => {
    /* If `match` is unreadable, narrowing is the safe guess: `or` would widen
       the audience, and widening is the one mistake with no undo. */
    expect(audienceFor({ mode: 'all', rules: [RULE] })).toMatchObject({
      match: 'and',
    });
    expect(
      audienceFor({ mode: 'all', rules: [RULE], match: 'nonsense' }),
    ).toMatchObject({ match: 'and' });
  });

  it('🔴 group mode is ACCEPTED — a group names OAs, not people', () => {
    /**
     * ⚠️ REVERSED 24/08. This read "group mode still refuses — no group key
     * exists in the registry", and that was right while `group_ids` was stored
     * and read by nobody: a group could only mean a narrowing this path could
     * not honour, and a dropped filter widens the audience.
     *
     * 🔴 WHAT CHANGED IS WHAT A GROUP MEANS, checked against the live data:
     *    `members` has NO group column, while `hooks.group` maps one group to
     *    many OAs. A group therefore selects **OAs**, and the audience is still
     *    decided by `rules` alone — which is exactly what comes back here.
     *    Nothing is dropped and nothing widens.
     *    group คัด OA ไม่ได้คัดคน ⇒ ไม่มีฟิลเตอร์ไหนถูกทิ้ง.
     *
     * The OA list is resolved and authorised at SAVE time
     * (`expandGroupsIntoHookIds`), so a run never expands a group itself.
     */
    expect(audienceFor({ mode: 'group', group_ids: ['g1'] })).toEqual({
      match: 'and',
      rules: [],
    });
    /* The conditions still ride along on a group-targeted job. */
    expect(
      audienceFor({ mode: 'group', group_ids: ['g1'], rules: [RULE] }),
    ).toMatchObject({ match: 'and' });
  });

  it('🔴 an UNKNOWN mode still refuses', () => {
    /* `all` and `group` are the two the normaliser writes. Anything else is a
       row nobody wrote on purpose. โหมดที่ไม่รู้จัก = ไม่ส่ง. */
    expect(audienceFor({ mode: 'sector', group_ids: ['g1'] })).toBeNull();
  });

  it('a non-array `rules` is treated as none, never as garbage', () => {
    expect(audienceFor({ mode: 'all', rules: 'display_name' })).toEqual({
      match: 'and',
      rules: [],
    });
  });
});

/* ── description: required where it can be, optional where it must be ────── */

describe('[FEAT-20260823-BCASTDESC] why the campaign exists', () => {
  /**
   * 🔴 REQUIRED ON CREATE, OPTIONAL ON UPDATE, and the asymmetry is the design:
   *    the COLUMN must stay optional because every campaign stored before the
   *    field existed has none, and `required: true` would make each of them
   *    fail to save the next time anyone edited it. A NEW campaign has no such
   *    history, so there is every reason to insist — a description nobody is
   *    asked for is a description nobody writes.
   *    งานเก่าต้องแก้ได้ · งานใหม่ต้องมีคำอธิบาย.
   */
  it('🔴 create refuses a blank one, and says what it wants', () => {
    expect(() => ensureValidDescription('', { required: true })).toThrow(
      /say what this campaign is for/,
    );
    expect(() => ensureValidDescription('   ', { required: true })).toThrow();
    expect(() =>
      ensureValidDescription(undefined, { required: true }),
    ).toThrow();
  });

  it('🔴 update lets a campaign that never had one through', () => {
    /* Renaming a 2025 broadcast cannot require writing its rationale first. */
    expect(ensureValidDescription(undefined, { required: false })).toBeNull();
    expect(ensureValidDescription('', { required: false })).toBeNull();
  });

  it('a real description is trimmed and kept', () => {
    expect(
      ensureValidDescription('  ส่งโปรเดือนนี้  ', { required: true }),
    ).toBe('ส่งโปรเดือนนี้');
  });

  it('🔴 too long is REFUSED, not truncated', () => {
    /* A cut explanation reads as a different sentence and the admin never
       learns theirs was too long — the same call `resolveTitle` made. */
    expect(() =>
      ensureValidDescription('ก'.repeat(501), { required: true }),
    ).toThrow(/at most 500/);
    expect(
      ensureValidDescription('ก'.repeat(500), { required: true }),
    ).toHaveLength(500);
  });
});

/* ── the log has to name the job, not just its id ────────────────────────── */

describe('[FEAT-20260823-BCASTACTOR] what a send log line says', () => {
  it('🔴 carries the job NAME as well as its id', () => {
    /* An id identifies the row; the name is what the admin calls it, what the
       list shows, and what they will say when they ask about it. A line with
       only an id makes every conversation start with a lookup.
       ต้องมีชื่อด้วย ไม่ใช่แค่ id. */
    const line = who('job1', { id: 'u1', name: 'Admin One' }, 'CRONTEST-1');
    expect(line).toContain('CRONTEST-1');
    expect(line).toContain('job1');
  });

  it('names the admin and their id', () => {
    const line = who('job1', { id: 'u1', name: 'Admin One' }, 'promo');
    expect(line).toContain('Admin One');
    expect(line).toContain('u1');
  });

  it('a job with no name still logs cleanly', () => {
    const line = who('job1', { name: 'scheduler' }, undefined);
    expect(line).toContain('job1');
    expect(line).toContain('scheduler');
    expect(line).not.toContain('undefined');
  });
});
