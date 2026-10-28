/* [FEAT-20260815-WLOGTTL30] the retention CLI's arithmetic and index naming
 * ===========================================================================
 * The dangerous half of this tool is not the Mongo call — it is the two numbers
 * that decide WHAT GETS DELETED. A wrong cutoff or a wrong seconds conversion
 * removes documents that cannot be recovered, and it does so silently, days
 * after the command was run.
 *
 * Importing this file must not connect to anything: the CLI keeps every side
 * effect inside `runCli()` behind `require.main === module`, and these cases
 * are the guard that the split stays that way.
 */
import {
  cutoffFor,
  secondsFor,
  targetIndexName,
  staleIndexNames,
  isOnField,
} from '@/cli/set-log-retention';

const DAY = 86_400_000;

describe('[WLOGTTL30] retention arithmetic', () => {
  it('45 days is 3,888,000 seconds — the value that goes into Mongo', () => {
    expect(secondsFor(45)).toBe(3_888_000);
  });

  it('30 days is 2,592,000 seconds — the first call, before the 45-day revision', () => {
    expect(secondsFor(30)).toBe(2_592_000);
  });

  it('90 days is 7,776,000 seconds — the policy this replaces', () => {
    expect(secondsFor(90)).toBe(7_776_000);
  });

  it('the cutoff is exactly N days back from now, not N-1 or N+1', () => {
    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    expect(cutoffFor(30, now).toISOString()).toBe(
      new Date(now - 30 * DAY).toISOString(),
    );
  });

  /* A day is treated as a fixed 86,400,000 ms, matching what Mongo's TTL monitor
     does. DST is irrelevant here and pinning it stops a "smarter" date library
     from silently shifting the boundary by an hour. */
  it('a day is a fixed 86,400,000 ms — no calendar arithmetic', () => {
    const now = Date.UTC(2026, 7, 15, 12, 0, 0);
    expect(now - cutoffFor(1, now).getTime()).toBe(DAY);
    expect(now - cutoffFor(365, now).getTime()).toBe(365 * DAY);
  });
});

describe('[WLOGTTL30] index naming — which one is installed, which is removed', () => {
  it('applying installs a name carrying the ACTUAL day count', () => {
    expect(targetIndexName(false, 45)).toBe('created_at_ttl45');
    expect(staleIndexNames(false, 45)).toContain('created_at_1');
  });

  /* THE BUG THIS FILE EXISTS FOR (15/08). The name used to be the constant
     'created_at_ttl30', so `--days 45` installed a 45-day TTL under a name that
     read "30" — the index behaved correctly and the name lied about it. Anyone
     reading Mongo later would have believed the name. Deriving the name from the
     same number that sets the TTL makes that disagreement unrepresentable.
     ชื่อกับค่าต้องมาจากเลขเดียวกัน — เคสนี้คือหลักฐานว่ามันไม่หลุดอีก */
  it('the name tracks --days — 30 and 45 never share a name', () => {
    expect(targetIndexName(false, 30)).toBe('created_at_ttl30');
    expect(targetIndexName(false, 45)).toBe('created_at_ttl45');
    expect(targetIndexName(false, 60)).toBe('created_at_ttl60');
    expect(targetIndexName(false, 30)).not.toBe(targetIndexName(false, 45));
  });

  /* Reverting must restore the ORIGINAL name. A revert that left a
     differently-named index behind would look fixed while the schema and the
     database disagreed on the name from then on. */
  it('reverting restores the original name whatever the day count', () => {
    expect(targetIndexName(true, 90)).toBe('created_at_1');
    expect(targetIndexName(true, 45)).toBe('created_at_1');
  });

  it('the index being installed is never in the list to drop', () => {
    for (const days of [30, 45, 90]) {
      for (const revert of [false, true]) {
        expect(staleIndexNames(revert, days)).not.toContain(
          targetIndexName(revert, days),
        );
      }
    }
  });

  /* A second retention change is where a name-based drop list breaks: the DB
     holds `created_at_ttl30` from the last run, a name the tool would not have
     guessed, and Mongo rejects the create because the key pattern is taken.
     Names found IN THE DATABASE must therefore feed the drop list.
     รอบสองคือรอบที่พัง ถ้าลบตามชื่อที่เดาไว้ล่วงหน้า */
  it('carries leftover names found in the database into the drop list', () => {
    const inDb = ['created_at_ttl30', 'created_at_1', 'created_at_ttl45'];
    const stale = staleIndexNames(false, 45, inDb);
    expect(stale).toContain('created_at_ttl30'); // last run's name
    expect(stale).toContain('created_at_1'); // the original
    expect(stale).not.toContain('created_at_ttl45'); // the one we want to keep
  });

  it('never asks to drop the same index twice', () => {
    const stale = staleIndexNames(false, 45, ['created_at_1', 'created_at_1']);
    expect(stale).toHaveLength(new Set(stale).size);
  });
});

/* Dropping is done by KEY PATTERN, so this predicate decides what gets removed.
   Too loose and it drops a compound index the log page needs — `status_1_created_at_-1`
   serves the dashboard's status-filtered queries and must survive. กว้างไปจะลบ
   index ที่หน้า log ใช้จริง */
describe('[WLOGTTL30] which indexes contend for the key pattern', () => {
  it('matches exactly {created_at: 1} and nothing else', () => {
    expect(isOnField({ created_at: 1 })).toBe(true);
  });

  it('leaves the compound status index alone', () => {
    expect(isOnField({ status: 1, created_at: -1 })).toBe(false);
    expect(isOnField({ created_at: 1, status: 1 })).toBe(false);
  });

  it('ignores indexes on other fields, and the _id index', () => {
    expect(isOnField({ _id: 1 })).toBe(false);
    expect(isOnField({ hook_id: 1 })).toBe(false);
    expect(isOnField(undefined)).toBe(false);
    expect(isOnField({})).toBe(false);
  });
});
