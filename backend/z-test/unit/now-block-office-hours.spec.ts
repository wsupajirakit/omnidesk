/**
 * [FEAT-20260902-NOWBLOCK] The WINDOW seam — `resolveOfficeHours(hook)`.
 *
 * Owner, 03/09/2026: *"ต้องสเกลได้ แยกอิสระ ห้ามกระทบ"* — the window must be settable,
 * the setting must scale past one server-wide pair, and doing either must disturb
 * nothing outside `now-block/`.
 *
 * ── WHAT THIS FILE IS FOR, AND WHY THE CONSTANTS ARE THE LEAST OF IT ───────
 * Before this seam the numbers were CHANGEABLE (edit one constant) but not
 * SCALABLE: `NowBlockInput` accepted `openMin`/`closeMin` overrides and the seat
 * never passed them, so nothing except a spec could ever vary the window. The case
 * that proves the seam is real is therefore not "the resolver returns 10:00-19:00" —
 * it is **`nowBlockText` asks the resolver, and a different answer changes the
 * block**. That is §"the door honours the resolver" below. Delete the two lines in
 * `index.ts` that call it and only those cases go red.
 *
 * revert: delete this file with the `now-block/` folder.
 */
/* eslint-disable no-restricted-imports -- a spy needs the module object the door
   actually calls into, which a barrel re-export does not give, and this folder is
   deliberately not re-exported from `@/modules/webhook`. Test-only; the layering
   rule is about production code. Same shape as broadcast-new-path-switch.spec.ts:19. */
import * as officeHoursSeam from '@/modules/webhook/now-block/policy/resolve-office-hours';
import { resolveOfficeHours } from '@/modules/webhook/now-block/policy/resolve-office-hours';
import {
  OFFICE_CLOSE_MIN,
  OFFICE_HOURS_TEXT,
  OFFICE_OPEN_MIN,
} from '@/modules/webhook/now-block/policy/office-hours';
import * as modeModule from '@/modules/webhook/now-block/now-block.mode';
import { nowBlockText } from '@/modules/webhook/now-block';
/* eslint-enable no-restricted-imports */

/** 02/09/2026 at the given Bangkok wall-clock hour. Not a holiday in the table. */
const bangkok = (hh: number, mm = 0): Date =>
  new Date(Date.UTC(2026, 8, 2, hh - 7, mm, 0));

/** Turn the feature on for a case. `now-block-mode.spec.ts` owns the switch itself. */
const switchOn = (): void => {
  jest.spyOn(modeModule, 'resolveNowBlockMode').mockReturnValue('on');
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('[NOWBLOCK] the window resolver — layer 2 answers today', () => {
  it('returns the policy constants, and they are the only source of the numbers', () => {
    expect(resolveOfficeHours(null)).toEqual({
      openMin: OFFICE_OPEN_MIN,
      closeMin: OFFICE_CLOSE_MIN,
      text: OFFICE_HOURS_TEXT,
    });
  });

  /* The same layer-1 pin the switch carries. The hook is accepted so that a per-OA
     window is a change inside this function; until that change is made, an OA
     document must not be able to move the window by itself. The day layer 1 lands,
     this case is expected to be REWRITTEN in the same commit. */
  it('PIN: an OA field cannot move the window while layer 1 is unimplemented', () => {
    expect(
      resolveOfficeHours({ office_open_min: 0, office_close_min: 1439 }),
    ).toEqual(resolveOfficeHours(null));
    expect(resolveOfficeHours({ ai_office_hours: '00:00-23:59' })).toEqual(
      resolveOfficeHours(null),
    );
  });

  /* A shared frozen constant would be cheaper by an allocation nobody can measure,
     and would let a future per-OA branch hand two OAs the same mutable object —
     a bug that only appears under load, in production, in one tenant. */
  it('hands out a fresh object per call, so one caller cannot corrupt another', () => {
    const a = resolveOfficeHours(null);
    const b = resolveOfficeHours(null);
    expect(a).not.toBe(b);
    a.openMin = 0;
    expect(resolveOfficeHours(null).openMin).toBe(OFFICE_OPEN_MIN);
  });

  /* `office-hours.ts:55-60` says in writing that nothing derives the display string,
     so a mismatch between it and the two numbers is invisible to every other test.
     This is that missing test: the string a CUSTOMER may read has to agree with the
     window the CODE enforces. ตัวเลขกับข้อความต้องตรงกัน ไม่งั้นลูกค้าได้เวลาผิด */
  it('the customer-facing string agrees with the minutes it describes', () => {
    const hhmm = (min: number): string =>
      `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const { openMin, closeMin, text } = resolveOfficeHours(null);
    expect(text).toContain(`${hhmm(openMin)}-${hhmm(closeMin)}`);
  });
});

describe('[NOWBLOCK] the door honours the resolver — this is the seam itself', () => {
  /* 🔴 THE CASE THAT MATTERS. If `index.ts` went back to reading the constants
     directly, everything above would still pass and the feature would be
     server-wide-forever again. This case is what makes that a red suite. */
  it('a resolved window reaches the rendered block', () => {
    switchOn();
    jest.spyOn(officeHoursSeam, 'resolveOfficeHours').mockReturnValue({
      openMin: 2 * 60,
      closeMin: 23 * 60,
      text: '02:00-23:00 ทุกวัน',
    });

    const text = nowBlockText({ hook: null, instant: bangkok(9) });
    expect(text).toContain('office_hours = 02:00-23:00 ทุกวัน');
    // 09:00 is BEFORE_OPEN under the default 10:00 window and OPEN under this one —
    // so the status proves the numbers were used, not just the display string.
    expect(text).toContain('status = OPEN');
  });

  it('and the default window still decides when nothing overrides it', () => {
    switchOn();
    const text = nowBlockText({ hook: null, instant: bangkok(9) });
    expect(text).toContain(`office_hours = ${OFFICE_HOURS_TEXT}`);
    expect(text).toContain('status = BEFORE_OPEN');
  });

  /* An explicit override on the request still wins over the resolver: specs pass one
     to exercise a boundary, and a caller that has already decided must not be
     second-guessed by the door. */
  it('an explicit request override outranks the resolver', () => {
    switchOn();
    jest.spyOn(officeHoursSeam, 'resolveOfficeHours').mockReturnValue({
      openMin: 2 * 60,
      closeMin: 23 * 60,
      text: '02:00-23:00 ทุกวัน',
    });

    const text = nowBlockText({
      hook: null,
      instant: bangkok(9),
      openMin: 12 * 60,
      closeMin: 13 * 60,
      officeHoursText: '12:00-13:00 เฉพาะเทส',
    });
    expect(text).toContain('office_hours = 12:00-13:00 เฉพาะเทส');
    expect(text).toContain('status = BEFORE_OPEN');
  });

  /* The window is asked for per call for the same reason the switch is: layer 1 will
     make the answer depend on which OA is asking. */
  it('is asked per call, never captured once', () => {
    switchOn();
    const spy = jest.spyOn(officeHoursSeam, 'resolveOfficeHours');
    nowBlockText({ hook: null, instant: bangkok(14) });
    nowBlockText({ hook: null, instant: bangkok(15) });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  /* OFF outranks everything in this file — no window, resolved or overridden, may
     put a block into a prompt while the switch is off. ปิดแล้วต้องไม่มี now โผล่ */
  it('resolves nothing at all while the switch is off', () => {
    const spy = jest.spyOn(officeHoursSeam, 'resolveOfficeHours');
    expect(nowBlockText({ hook: null, instant: bangkok(14) })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
