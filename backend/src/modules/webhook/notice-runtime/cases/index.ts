/**
 * [FEAT-20260822-NOTICERUNTIME] The case order — ⭐ THE ONE PLACE TO RESWAP.
 * ===========================================================================
 * Owner, D13 (22/08): time-window cases beat site-rule cases when both match
 * — "ตอนนี้วันนี้เอาแบบนี้ก่อน แต่ว่าต้องแก้ไขสลับได้ง่าย seamless". So the
 * order is DATA: the first case in this array whose `when` answers true wins,
 * and exactly one card fires per event. Reorder the array — nothing else —
 * to change precedence. A deleted case file = delete its line here too.
 * revert: delete the cases/ folder and the orchestrator's import of it.
 */
import { CASE_A } from './case-a-deposit-offtime';
import { CASE_B } from './case-b-deposit-disable';
import { CASE_C } from './case-c-withdraw-offtime';
import { CASE_D } from './case-d-withdraw-disable';
import { CASE_E } from './case-e-all-offtime';
import { CASE_F } from './case-f-all-disable';
import type { NoticeCase } from './notice-case.types';

/** Time-first (A,C before B,D · E before F), deposit before withdraw. */
export const NOTICE_CASE_ORDER: readonly NoticeCase[] = [
  CASE_A,
  CASE_C,
  CASE_B,
  CASE_D,
  CASE_E,
  CASE_F,
];

export * from './notice-case.types';
export { CASE_A, CASE_B, CASE_C, CASE_D, CASE_E, CASE_F };
