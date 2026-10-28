import {
  buildFollowUpClear,
  CLOSE_CASE_CLEARED_KEYS,
} from '@/modules/tickets/close-case-follow-up.helper';

/**
 * [FEAT-20260826-CLOSECLEARFU] Closing a case can stop chasing this customer.
 * ===========================================================================
 * Owner, 26/08/2026: when an admin closes a case and the member carries BOTH
 * `abandon_trigger_at` and `request_reg_at`, the confirm dialog offers two
 * boxes; ticking "หยุดติดตาม" clears both stamps for that member.
 *
 * 🔴 THIS DELIBERATELY OVERRIDES A STANDING RULE, so the tests below are the
 * only place that records the new boundary. `request_reg_at` was documented in
 * five files as never-cleared ("ห้ามเคลียร์ห้ามยุ่ง คงค่าเดิม"); the owner was
 * shown that note, and the consequence that the registration insight card moves
 * a row from "Bot ช่วย Admin" to "แอดมิน" every time this fires, and confirmed
 * the change anyway on 26/08/2026.
 *
 * WHAT MUST STAY TRUE regardless: the OTHER clearer — the one that runs when a
 * customer registers (`clear-follow-up-on-register.helper.ts`) — must still
 * leave `request_reg_at` alone. Two different doors, only one of them new.
 * `clear-follow-up-on-register.spec.ts:40` guards that and must stay green.
 *
 * The decision is a pure function so it can be proved without a database: the
 * risky part here is not the `$unset`, it is deciding WHEN to fire one.
 */
describe('close-case follow-up clear — the decision', () => {
  const both = {
    config: {
      follow_up: {
        line: {
          abandon_trigger_at: new Date('2026-08-20T03:00:00Z'),
          request_reg_at: new Date('2026-08-19T03:00:00Z'),
        },
      },
    },
  };

  it('clears both stamps when the case closed and the box was ticked', () => {
    const plan = buildFollowUpClear({
      becameClosed: true,
      requested: true,
      member: both,
    });

    expect(plan.shouldClear).toBe(true);
    // both keys, and nothing else — a third key here would be silent scope creep
    expect(plan.keys).toEqual([
      'follow_up.line.abandon_trigger_at',
      'follow_up.line.request_reg_at',
    ]);
  });

  it('does nothing when the admin did not tick the box', () => {
    const plan = buildFollowUpClear({
      becameClosed: true,
      requested: false,
      member: both,
    });
    expect(plan.shouldClear).toBe(false);
    expect(plan.keys).toEqual([]);
  });

  it('does nothing when the flag was never sent', () => {
    /* 🔴 THE GHOST-KEY CASE. `main.ts` runs the pipe with `transform: true`, so
       class-transformer materialises EVERY declared DTO property — a request
       that never mentioned the flag still arrives carrying the key with value
       `undefined`. `[FIX-20260824-CASGHOST]` records the same trap costing a
       real bug on stg when `in` was used instead of a value check. If this ever
       goes green while the code reads `'clear_follow_up' in dto`, every close in
       the system would start wiping stamps. */
    const plan = buildFollowUpClear({
      becameClosed: true,
      requested: undefined,
      member: both,
    });
    expect(plan.shouldClear).toBe(false);
  });

  it('does nothing when the write was not a close', () => {
    // accepting a case, renaming a category — same endpoint, different intent
    const plan = buildFollowUpClear({
      becameClosed: false,
      requested: true,
      member: both,
    });
    expect(plan.shouldClear).toBe(false);
  });

  it.each([
    [
      'only abandon_trigger_at',
      { config: { follow_up: { line: { abandon_trigger_at: new Date() } } } },
    ],
    [
      'only request_reg_at',
      { config: { follow_up: { line: { request_reg_at: new Date() } } } },
    ],
    ['no follow_up at all', { config: {} }],
    ['no config at all', {}],
    ['a null member', null],
  ])('does nothing when the member carries %s', (_label, member) => {
    /* The dialog only offers the boxes when BOTH stamps are present, so a
       request asking to clear a member who has only one is either a stale tab
       or a hand-crafted call. Either way the answer is no: clearing half the
       pair leaves a state the UI can never produce. */
    const plan = buildFollowUpClear({
      becameClosed: true,
      requested: true,
      member,
    });
    expect(plan.shouldClear).toBe(false);
  });

  it('treats a null or empty stamp as absent, not as present', () => {
    // `$unset` leaves the key missing, but a legacy row can hold an explicit
    // null. Reading null as "has a value" would offer the boxes for a member
    // the feature has already been used on.
    const plan = buildFollowUpClear({
      becameClosed: true,
      requested: true,
      member: {
        config: {
          follow_up: {
            line: { abandon_trigger_at: null, request_reg_at: new Date() },
          },
        },
      },
    });
    expect(plan.shouldClear).toBe(false);
  });

  it('exports the two keys as the single source of what gets cleared', () => {
    // The helper and the audit row must name the same keys; two hand-typed
    // lists drift the moment one of them is edited.
    expect(CLOSE_CASE_CLEARED_KEYS).toEqual([
      'follow_up.line.abandon_trigger_at',
      'follow_up.line.request_reg_at',
    ]);
  });
});
