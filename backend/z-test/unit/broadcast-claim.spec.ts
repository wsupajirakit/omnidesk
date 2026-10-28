/**
 * [FEAT-20260822-BCASTCLAIM] The filter IS the lock. These cases pin the shapes,
 * because a wrong filter here means two processes send the same campaign.
 */
import {
  CLAIMABLE_FROM,
  CLAIMED_STATE,
  buildClaimQuery,
  buildHeartbeatQuery,
  buildReleaseQuery,
  buildStaleClaimFilter,
  computeLeaseMs,
} from '@/modules/content';

const NOW = new Date('2026-08-22T10:00:00.000Z');

describe('claim — one process takes the job, the other gets null', () => {
  it('makes the status transition the lock', () => {
    const q = buildClaimQuery('job1', 'worker-a', NOW);
    expect(q?.filter['status']).toEqual({ $in: [...CLAIMABLE_FROM] });
    expect(q?.update.$set['status']).toBe(CLAIMED_STATE);
    expect(q?.options.new).toBe(true);
  });

  it('🔴 excludes soft-deleted jobs — deleteBroadcast never touches status', () => {
    const q = buildClaimQuery('job1', 'worker-a', NOW);
    expect(q?.filter['deleted_at']).toEqual({ $exists: false });
  });

  it('sets a lease that outlives the longest run the guards allow', () => {
    const q = buildClaimQuery('job1', 'worker-a', NOW);
    const lease = q?.update.$set['lease_until'] as Date;
    expect(lease.getTime() - NOW.getTime()).toBe(computeLeaseMs());
  });

  it('refuses to build a claim it cannot make safely', () => {
    expect(buildClaimQuery('', 'w', NOW)).toBeNull();
    expect(buildClaimQuery('job1', '', NOW)).toBeNull();
    expect(buildClaimQuery('job1', 'w', new Date('nope'))).toBeNull();
  });

  it('a bad lease falls back to the computed one rather than zero', () => {
    const q = buildClaimQuery('job1', 'w', NOW, Number.NaN);
    const lease = q?.update.$set['lease_until'] as Date;
    expect(lease.getTime() - NOW.getTime()).toBe(computeLeaseMs());
  });
});

describe('heartbeat — only the holder may extend its own claim', () => {
  it('🔴 filters on claimed_by, or a swept process could push out the new holder', () => {
    const q = buildHeartbeatQuery('job1', 'worker-a', NOW);
    expect(q?.filter['claimed_by']).toBe('worker-a');
    expect(q?.filter['status']).toBe(CLAIMED_STATE);
    expect(Object.keys(q?.update.$set ?? {})).toEqual(['lease_until']);
  });
});

describe('release — hand it back and leave no trace', () => {
  it('only the holder can release, and the claim columns are removed', () => {
    const q = buildReleaseQuery('job1', 'worker-a', 'sent');
    expect(q?.filter).toEqual({
      _id: 'job1',
      status: CLAIMED_STATE,
      claimed_by: 'worker-a',
    });
    expect(q?.update.$set['status']).toBe('sent');
    expect(Object.keys(q?.update.$unset ?? {}).sort()).toEqual([
      'claimed_at',
      'claimed_by',
      'lease_until',
    ]);
  });

  it('a repeat job goes back to scheduled rather than finishing', () => {
    expect(
      buildReleaseQuery('j', 'w', 'scheduled')?.update.$set['status'],
    ).toBe('scheduled');
  });

  it('refuses an incomplete release', () => {
    expect(buildReleaseQuery('j', 'w', '')).toBeNull();
    expect(buildReleaseQuery('j', '', 'sent')).toBeNull();
  });
});

describe('sweep — and why it can never touch an old job', () => {
  it('looks only at rows this feature itself wrote', () => {
    const f = buildStaleClaimFilter(NOW);
    expect(f?.['status']).toBe(CLAIMED_STATE);
    expect(f?.['lease_until']).toEqual({ $lt: NOW });
  });

  it('🔴 uses no $exists anywhere — that is what makes it backfill-free', () => {
    // handoff-job.schema.ts needs an epoch default because a MISSING date never
    // matches {$lt}. Claiming by status transition avoids the problem entirely,
    // so every job that existed before this feature is untouched.
    const f = buildStaleClaimFilter(NOW);
    expect(JSON.stringify(f)).not.toContain('$exists');
  });

  it('refuses an unusable clock', () => {
    expect(buildStaleClaimFilter(new Date('nope'))).toBeNull();
  });
});
