/**
 * [FEAT-20260830-FOLLOWUPFRESH] the close-case dialog reads follow-up on OPEN.
 *
 * 🔴 Owner 30/08: *"เวลากดปิดเคส ต้องดึงข้อมูล follow up มาเช็คแบบ realtime
 *    (ตอนนี้ไม่ใช่ใช่ไหม)"* — correct, it was not. `selectedRoom` is loaded when
 *    the admin opens the room and never refreshed, so a stamp written or cleared
 *    in between left the dialog offering a choice the server would ignore.
 *
 * Source-level on purpose: the failure is about WHICH value feeds the rule and
 * WHEN the request fires. A DOM test of the dialog passed happily while it was
 * reading month-old data.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const SRC = read('../pages/chat/TicketChat.tsx');
const CODE = stripComments(SRC);

describe('the read is wired to the dialog opening', () => {
  it('it calls the fresh reader', () => {
    expect(CODE).toContain('readFollowStamps(');
  });

  it('the effect fires on the dialog opening, not on every render', () => {
    expect(CODE).toMatch(/\}, \[closeDialogOpen, closeMemberId\]\)/);
  });

  it('"open" means CLOSING a case — the same dialog also serves รับเคส', () => {
    expect(CODE).toMatch(/closeDialogOpen\s*=\s*confirmAction\?\.targetStatus === 2/);
  });

  it('it asks about the member the panel is showing', () => {
    expect(CODE).toMatch(/closeMemberId[\s\S]{0,160}user_data[\s\S]{0,60}_id/);
  });

  it('a superseded read cannot land — EVERY branch is guarded', () => {
    /* MUTATION NOTE: an earlier version only asked that `if (alive)` appeared
       somewhere in the effect. Deleting the guard from the SUCCESS branch alone
       left the others in place and the test stayed green — while a slow read
       for the previous member could still overwrite a newer one, which is the
       whole reason the flag exists. Each branch is pinned separately now. */
    const at = CODE.indexOf('readFollowStamps(');
    const body = CODE.slice(Math.max(0, at - 600), at + 1100);
    expect(body).toMatch(/let alive = true/);
    expect(body).toMatch(/alive = false/);
    // success: the snapshot may only be stored behind the guard
    expect(body).toMatch(/if \(alive\) setFreshRoom\(/);
    // failure and settle likewise
    expect(body).toMatch(/if \(alive\) setFreshFailed\(/);
    expect(body).toMatch(/if \(alive\) setFreshLoading\(/);
    // and no setter may be called outside the guard inside the promise chain
    const chain = body.slice(body.indexOf('readFollowStamps('));
    const unguarded = chain
      .split('\n')
      .filter((l) => /set(FreshRoom|FreshFailed|FreshLoading)\(/.test(l))
      .filter((l) => !/if \(alive\)/.test(l));
    expect(unguarded).toEqual([]);
  });
});

describe('🔴 the fresh data actually decides', () => {
  it('the topics come from the snapshot first, the room only as fallback', () => {
    expect(CODE).toMatch(
      /closeCaseTopicsFor\(\s*freshRoom \?\? selectedRoom,/,
    );
  });

  it('it never reads selectedRoom alone for the topics', () => {
    expect(CODE).not.toMatch(/closeCaseTopicsFor\(\s*selectedRoom,/);
  });

  it('ONE rule still decides which sections show', () => {
    // feeding a second decision procedure here is how screen and server drift
    const calls = CODE.match(/closeCaseTopicsFor\(/g) ?? [];
    expect(calls.length).toBe(1);
  });
});

describe('the admin is told what is happening', () => {
  it('a spinner strip while the read is in flight', () => {
    expect(CODE).toContain('close-case-fresh-loading');
    expect(CODE).toMatch(/closeDialogOpen && freshLoading/);
  });

  it('a warning when the read failed, so stale data is never passed off as fresh', () => {
    expect(CODE).toContain('close-case-fresh-failed');
    expect(CODE).toMatch(/closeDialogOpen && freshFailed/);
  });

  it('both messages are translated, not hardcoded Thai in the JSX', () => {
    expect(CODE).toContain("t('ticket.close_case_checking_follow_up')");
    expect(CODE).toContain("t('ticket.close_case_follow_up_stale')");
  });

  it('the failure strip is an alert, so a screen reader announces it', () => {
    const at = CODE.indexOf('close-case-fresh-failed');
    expect(CODE.slice(at, at + 200)).toContain('role="alert"');
  });
});

describe('confirm is blocked while the answer is still coming', () => {
  it('the button is disabled during the read', () => {
    expect(CODE).toMatch(/confirmDisabled=\{freshLoading\}/);
  });

  it('and the handler refuses too — a disabled button is not a guarantee', () => {
    const at = CODE.indexOf('onConfirm={');
    const body = CODE.slice(at, at + 700);
    expect(body).toMatch(/if \(freshLoading\) return;/);
  });

  it('the missing-topics gate still runs after it', () => {
    const at = CODE.indexOf('onConfirm={');
    const body = CODE.slice(at, at + 700);
    expect(body.indexOf('freshLoading')).toBeLessThan(
      body.indexOf('missingTopics('),
    );
  });
});

describe('the strings exist in both locales', () => {
  const th = JSON.parse(read('../i18n/translations/th.json')) as Record<string, string>;
  const en = JSON.parse(read('../i18n/translations/en.json')) as Record<string, string>;

  it.each([
    'ticket.close_case_checking_follow_up',
    'ticket.close_case_follow_up_stale',
  ])('%s is translated in th and en', (key) => {
    expect(th[key]).toBeTruthy();
    expect(en[key]).toBeTruthy();
    expect(th[key]).not.toBe(en[key]);
  });
});
