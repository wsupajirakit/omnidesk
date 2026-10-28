/**
 * [FIX-20260829-STATUSFIRSTRT] the switch must SURVIVE reopening the form
 * ===========================================================================
 * Reported by the owner with a screenshot, first real use: tick the new
 * "prefer status" switch, save, reopen — unchecked. "มีบัคเซฟแล้วไม่ติด".
 *
 * 🔴 THE SAVE WAS NEVER THE PROBLEM. The route stored the field; the form's
 *    initialData mapping in `HookFormModal.tsx` is a hand-built copy, field by
 *    field, and the two new names were not in it — so the value came back from
 *    the server and was dropped on the floor before render. This is EXACTLY the
 *    silent-drop layer dev-local §5 lists first ("FE response normalizer builds
 *    a NEW object; anything unlisted is gone"), missed despite the warning.
 *
 * 🔴 THE TEST IS A LIST-DIFF, NOT A CASE PAIR, on purpose: it asserts that every
 *    name in `NOTICE_FORM_FIELDS` appears in the mapping source — so the NEXT
 *    notice field added without its round-trip half goes red here by name,
 *    instead of shipping and waiting for a screenshot.
 *
 * revert: none — this pins a contract, not a behaviour choice.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { NOTICE_FORM_FIELDS } from '../components/hook/form/noticeCardGate';

const src = readFileSync('components/hook/HookFormModal.tsx', 'utf8');

describe('[STATUSFIRSTRT] every notice field makes the round trip', () => {
  it('⭐⭐ 🔴 each NOTICE_FORM_FIELDS name is read back from initialData', () => {
    const missing = NOTICE_FORM_FIELDS.filter(
      (f) => !src.includes(`(initialData as any).${f}`),
    );
    expect(missing).toEqual([]);
  });

  it('⭐⭐ 🔴 each name also has a DEFAULT_FORM seed, so a NEW hook renders it', () => {
    const missing = NOTICE_FORM_FIELDS.filter(
      (f) => !new RegExp(`^\\s*${f}:`, 'm').test(src),
    );
    expect(missing).toEqual([]);
  });

  it('⭐⭐ the new pair reads back with default-off polarity (=== true), never !== false', () => {
    /* `!== false` is the check-flags' polarity; on this pair it would flip every
       legacy row ON — the exact debt the owner forbade. */
    expect(src).toContain('(initialData as any).notice_deposit_sitestatus_first === true');
    expect(src).toContain('(initialData as any).notice_withdraw_sitestatus_first === true');
    expect(src).not.toContain('notice_deposit_sitestatus_first !== false');
  });
});
