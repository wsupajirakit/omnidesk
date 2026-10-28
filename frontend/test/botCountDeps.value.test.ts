/**
 * [FIX-20260820-BOTCOUNTSTALE] the บอทดูแล badge went to 0 the moment you opened the tab
 * ============================================================================
 * Owner, 20/08, with two screenshots: "ตอนยังไม่คลิกแสดง 1 บอทดูแลถูกต้อง แต่คลิกแท็บ
 * ทำไมกลายเป็น 0" — and, in the same breath, "ห้ามแก้ไขแท็บอื่น ห้ามยุ่ง ห้ามกระทบแท็บอื่น".
 *
 * THE CAUSE IS A MISSING DEPENDENCY, not a filter and not a count rule.
 * `TicketChat.tsx`'s `counts` memo reads `botRows`, but `botRows` was not in its
 * dependency array. The sequence:
 *
 *   not on the tab   badge = botUserKeys.size + noCaseRooms   → 1, from the server
 *   click the tab    `statusTab` IS a dep → the memo re-runs immediately, but
 *                    `orphanRooms` has not arrived yet, so `botRows` is empty
 *                    and the branch drops the server number → 0
 *   rooms arrive     `botRows` changes → the memo does NOT re-run, because it
 *                    never declared it → the badge stays 0 while the LIST, which
 *                    does depend on it, renders the row
 *
 * ⚠️ WHY THIS CANNOT TOUCH ANOTHER TAB. `mine`, `waiting`, `active` and `ended`
 * are computed from `activeTickets` / `completedTickets` / `completedTotal` and
 * never read `botRows` — asserted below, line by line. Adding a dependency only
 * makes the memo recompute more often; with the same inputs it returns the same
 * values, so no other badge can move. เพิ่ม dep = คำนวณถี่ขึ้น ค่าเท่าเดิม.
 *
 * The page is ~3k lines and cannot be rendered here, so this reads the source —
 * with comments stripped, so a sentence can never satisfy an assertion.
 *
 * revert: remove `botRows` from that dependency array; the badge goes back to
 * zeroing itself the moment the tab is opened.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../pages/chat/TicketChat.tsx'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The `counts` memo: from `const counts = useMemo(` to its dependency array. */
function countsMemo(): { body: string; deps: string } {
  const from = src.indexOf('const counts = useMemo(');
  expect(from).toBeGreaterThan(-1);
  const depsAt = src.indexOf('  }, [', from);
  expect(depsAt).toBeGreaterThan(from);
  const depsEnd = src.indexOf(']);', depsAt);
  return {
    body: src.slice(from, depsAt),
    deps: src.slice(depsAt, depsEnd + 3),
  };
}

describe('⭐ the badge recomputes when the rows it counts arrive', () => {
  it('the counts memo reads botRows', () => {
    expect(countsMemo().body).toContain('botRows');
  });

  it('⭐ and declares it, or the badge freezes at whatever it saw first', () => {
    /* THE fix. Without this the memo keeps the value it computed while the rooms
       were still loading, which is zero. */
    expect(countsMemo().deps).toMatch(/\bbotRows\b/);
  });

  it('every other value it reads is declared too — no second stale badge', () => {
    const { body, deps } = countsMemo();
    for (const dep of [
      'activeTickets',
      'completedTickets',
      'completedTotal',
      'noCaseRooms',
      'statusTab',
    ]) {
      if (body.includes(dep)) expect(deps).toMatch(new RegExp(`\\b${dep}\\b`));
    }
  });
});

describe('⭐ no other tab can move — "ห้ามกระทบแท็บอื่น", measured', () => {
  const { body } = countsMemo();

  /** The one returned expression for a tab, e.g. `mine: ...` up to the newline. */
  const lineFor = (key: string): string => {
    const at = body.indexOf(`${key}:`);
    expect(at).toBeGreaterThan(-1);
    return body.slice(at, body.indexOf('\n', at));
  };

  it.each(['mine', 'waiting', 'active', 'ended'])(
    '%s is computed without botRows',
    (key) => {
      expect(lineFor(key)).not.toContain('botRows');
    },
  );

  it.each(['mine', 'waiting', 'active'])(
    '%s still counts from the active tickets, untouched',
    (key) => {
      expect(lineFor(key)).toContain('filteredActive');
    },
  );

  it('ended still uses the server total, untouched', () => {
    expect(lineFor('ended')).toContain('endedCount');
  });

  it('⭐ botRows is read in exactly ONE place inside the memo', () => {
    /* if it ever appears twice, something else started depending on it and this
       file's "cannot affect other tabs" claim would need re-proving. */
    expect(body.split('botRows').length - 1).toBe(1);
  });
});
