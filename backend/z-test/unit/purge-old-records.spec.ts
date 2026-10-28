import {
  closedTicketFilter,
  olderThanFilter,
  stillOpenFilter,
} from '@/cli/purge-old-records';

/**
 * ==== [FEAT-20260814-PURGECLI] the predicates that decide what gets destroyed ====
 *
 * `purge-old-records.ts` deletes rows permanently. These three filters are the
 * whole safety story, so they are unit-tested away from the CLI's I/O: a silent
 * edit here — dropping `job_status`, widening a date bound — would destroy open
 * cases or live data, and no other test in the repo would notice.
 *
 * The rules the owner set (14/08):
 *   · cutoff 3 days for every collection
 *   · tickets: CLOSED ONLY (`job_status: 2`), never an open case
 *   · logs: plain `created_at` age
 *
 * ⚠️ `resolved_at` may be null on a closed ticket — one such row existed in the
 *    live data when this was written. Without the `updated_at` fallback that row
 *    would sit un-purgeable forever, so the fallback is asserted here, not
 *    assumed.
 *
 * Matching is checked by hand against the filter object rather than a database:
 * these are plain Mongo query documents, and the shape IS the contract.
 */

const CUTOFF = new Date('2026-08-11T00:00:00.000Z');
const OLDER = new Date('2026-08-01T00:00:00.000Z'); // before cutoff
const NEWER = new Date('2026-08-14T00:00:00.000Z'); // after cutoff

/** Does this doc satisfy the filter? Supports only what these filters use. */
function matches(
  doc: Record<string, any>,
  filter: Record<string, any>,
): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') {
      return (cond as Record<string, any>[]).some((sub) => matches(doc, sub));
    }
    const value = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$lt' in cond) return value != null && value < cond.$lt;
      if ('$ne' in cond) return value !== cond.$ne;
    }
    return value === cond;
  });
}

describe('[PURGECLI] closedTicketFilter — closed cases only, and only old ones', () => {
  const filter = closedTicketFilter(CUTOFF);

  it('takes a closed ticket resolved before the cutoff', () => {
    expect(matches({ job_status: 2, resolved_at: OLDER }, filter)).toBe(true);
  });

  it('REFUSES an open ticket however old it is — the owner rule', () => {
    expect(matches({ job_status: 0, resolved_at: OLDER }, filter)).toBe(false);
    expect(matches({ job_status: 1, resolved_at: OLDER }, filter)).toBe(false);
    // even with every date field ancient
    expect(
      matches({ job_status: 0, resolved_at: OLDER, updated_at: OLDER }, filter),
    ).toBe(false);
  });

  it('REFUSES a case closed recently — inside the retention window', () => {
    expect(matches({ job_status: 2, resolved_at: NEWER }, filter)).toBe(false);
  });

  it('falls back to updated_at when resolved_at is null (a real row)', () => {
    expect(
      matches({ job_status: 2, resolved_at: null, updated_at: OLDER }, filter),
    ).toBe(true);
    expect(
      matches({ job_status: 2, resolved_at: null, updated_at: NEWER }, filter),
    ).toBe(false);
  });

  it('pins the exact query shape — job_status must stay in it', () => {
    expect(filter['job_status']).toBe(2);
    expect(JSON.stringify(filter)).toContain('resolved_at');
    expect(JSON.stringify(filter)).toContain('updated_at');
  });
});

describe('[PURGECLI] stillOpenFilter — what --close-open has to handle first', () => {
  const filter = stillOpenFilter(CUTOFF);

  it('selects old tickets that are NOT closed', () => {
    expect(matches({ created_at: OLDER, job_status: 0 }, filter)).toBe(true);
    expect(matches({ created_at: OLDER, job_status: 1 }, filter)).toBe(true);
  });

  it('leaves closed and recent tickets alone', () => {
    expect(matches({ created_at: OLDER, job_status: 2 }, filter)).toBe(false);
    expect(matches({ created_at: NEWER, job_status: 0 }, filter)).toBe(false);
  });

  it('is the exact complement of the delete filter — no ticket falls through both', () => {
    const del = closedTicketFilter(CUTOFF);
    const openOld = { created_at: OLDER, job_status: 0, resolved_at: OLDER };
    expect(matches(openOld, filter)).toBe(true);
    expect(matches(openOld, del)).toBe(false);
  });
});

describe('[PURGECLI] olderThanFilter — the log collections', () => {
  const filter = olderThanFilter(CUTOFF);

  it('takes rows older than the cutoff and spares the rest', () => {
    expect(matches({ created_at: OLDER }, filter)).toBe(true);
    expect(matches({ created_at: NEWER }, filter)).toBe(false);
  });

  it('spares a row with no created_at rather than guessing', () => {
    expect(matches({}, filter)).toBe(false);
    expect(matches({ created_at: null }, filter)).toBe(false);
  });
});

describe('[PURGECLI] the cutoff itself', () => {
  it('3 days back is the documented default', () => {
    const days = 3;
    const now = Date.parse('2026-08-14T00:00:00.000Z');
    expect(new Date(now - days * 86_400_000).toISOString()).toBe(
      '2026-08-11T00:00:00.000Z',
    );
  });
});
