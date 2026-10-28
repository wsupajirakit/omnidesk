/**
 * [FEAT-20260822-BCASTUSAGE] The counters that make the flood guard and the
 * global budget real rather than parameters nobody fills in.
 */
import {
  DAY_MS,
  HOUR_MS,
  countRunsInFlight,
  countRunsOfJob,
  countRunsOfUser,
  findResumePoint,
  sumUsageSince,
  usageWindowQueries,
} from '@/modules/content';

const NOW = new Date('2026-08-22T12:00:00.000Z');
const HOUR_AGO = new Date('2026-08-22T11:00:00.000Z');
const DAY_AGO = new Date('2026-08-21T12:00:00.000Z');

describe('run counts — what abuse-guard asks for', () => {
  it('counts one job over the last hour', () => {
    const q = countRunsOfJob('job1', NOW);
    expect(q?.collection).toBe('broadcasts_histories');
    expect(q?.filter['broadcast_id']).toBe('job1');
    expect(q?.filter['started_at']).toEqual({ $gte: HOUR_AGO });
  });

  it('counts one user across every job', () => {
    const q = countRunsOfUser('u1', NOW);
    expect(q?.filter['triggered_by_user']).toBe('u1');
    expect(q?.filter['started_at']).toEqual({ $gte: HOUR_AGO });
  });

  it('🔴 in-flight is "started and not finished", NOT a time window', () => {
    // A run stuck for 40 minutes still holds a slot; treating it as expired
    // would let the system oversubscribe itself.
    const q = countRunsInFlight();
    expect(q.filter['started_at']).toEqual({ $exists: true });
    expect(q.filter['finished_at']).toEqual({ $exists: false });
    expect(JSON.stringify(q.filter)).not.toContain('$gte');
  });

  it('refuses to build a count it cannot scope', () => {
    expect(countRunsOfJob(null, NOW)).toBeNull();
    expect(countRunsOfUser('u1', new Date('nope'))).toBeNull();
  });
});

describe('usage sums — what global-quota asks for', () => {
  it('🔴 sums what actually left, not what was aimed at', () => {
    // A refused run spent nothing and must not consume anyone's quota.
    const q = sumUsageSince(NOW, HOUR_MS);
    expect(q?.sum).toEqual(['sent', 'requests_made']);
    expect(q?.sum).not.toContain('targeted');
  });

  it('gives an hour and a day over the same scope', () => {
    const w = usageWindowQueries(NOW);
    expect(w?.hour.filter['started_at']).toEqual({ $gte: HOUR_AGO });
    expect(w?.day.filter['started_at']).toEqual({ $gte: DAY_AGO });
  });

  it('combined scope carries no hook filter — that is what makes it combined', () => {
    const w = usageWindowQueries(NOW);
    expect(w?.hour.filter['hook_id']).toBeUndefined();
  });

  it('per-oa scope adds the hook, and only then', () => {
    const w = usageWindowQueries(NOW, 'hookA');
    expect(w?.hour.filter['hook_id']).toBe('hookA');
    expect(w?.day.filter['hook_id']).toBe('hookA');
  });

  it('a day window really is 24 hours', () => {
    expect(DAY_MS).toBe(24 * HOUR_MS);
  });

  it('refuses an unusable clock', () => {
    expect(sumUsageSince(new Date('nope'), HOUR_MS)).toBeNull();
    expect(usageWindowQueries(new Date('nope'))).toBeNull();
  });
});

describe('resume lookup — where an interrupted OA left off', () => {
  it('finds the newest row for this job, OA and run', () => {
    const q = findResumePoint('job1', 'hookA', 'run1');
    expect(q?.filter).toEqual({
      broadcast_id: 'job1',
      hook_id: 'hookA',
      run_id: 'run1',
    });
    expect(q?.sort).toEqual({ started_at: -1 });
    expect(q?.limit).toBe(1);
  });

  it('refuses an incomplete lookup rather than matching too much', () => {
    expect(findResumePoint('job1', 'hookA', '')).toBeNull();
    expect(findResumePoint('job1', null, 'run1')).toBeNull();
    expect(findResumePoint(null, 'hookA', 'run1')).toBeNull();
  });
});
