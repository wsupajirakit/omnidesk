import { getValidatedEnv } from '../../config/env.schema';

import {
  DEFAULT_SUSPEND_AT,
  DEFAULT_SUSPEND_WINDOW_HOURS,
} from './strike-suspend.helper';

/**
 * [FEAT-20260824-STRIKESESSION] The one switch for strike tracking.
 * ===========================================================================
 * 📖 HANDOVER DOC: `docs/strike-session.md` — read that first; it is the operating
 *    manual (what it is, the API, permissions, how to switch it on and off).
 *    Design + measurements: `docs/strike-count-design.md`.
 *
 * Owner, 24/08/2026: *"ต้อง seamless ใช้/ไม่ใช้ก็ได้ ต่อท่อ เปิด ปิด ไม่กระทบ"*.
 *
 * IN CODE, NOT ENV — the same decision already taken for the rate ladder
 * (`webhook/rate-limit/user-rate-ladder.service.ts:78`, owner: "ไม่ใช้ env ใช้ code").
 * Keeping both switches in the same medium means one deploy changes both
 * predictably, and neither can be flipped by an env nobody reviewed.
 *
 * THREE WAYS TO TURN THIS OFF, weakest to strongest — all revert cleanly:
 *   1. `enabled: false` here     → `record()` returns before any Mongo call.
 *                                  The REST routes still serve existing rows.
 *   2. drop `StrikeModule` from `webhook.module.ts` imports
 *                                → `webhook.service.ts` resolves the optional
 *                                  sink to `undefined`; the tap becomes
 *                                  `undefined?.record()`, i.e. byte-identical
 *                                  behaviour to before this feature existed.
 *   3. drop `StrikeModule` from `app.module.ts`
 *                                → routes gone too. The two collections are
 *                                  simply left alone; nothing reads or writes
 *                                  them. No migration to undo.
 *
 * WHY TURNING IT OFF CANNOT DISTURB THE RATE LIMITER: the tap runs AFTER
 * `consume()` has already decided and already written its Redis counter, and it
 * is never awaited. It cannot change the verdict, the counter, or the reply.
 * See `strike-sink.port.ts` for the full ordering argument.
 *
 * revert: delete `src/modules/strike/`, the import in `app.module.ts`, the
 * import in `webhook.module.ts`, and the tap in `webhook.service.ts`.
 */
export interface StrikeTrackingConfig {
  /** false = record nothing. Reads keep working on rows already stored. */
  enabled: boolean;

  /**
   * [FEAT-20260826-STRIKESUSPEND] The gate's two knobs, resolved from env.
   * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
   *
   * ⚠️ SETTING THESE DOES NOT TURN THE GATE ON. They only say WHERE the line is
   * once it is on; the feature itself is on only when `STRIKE_GATE` is bound in
   * the webhook. Two switches, and the one that matters is the binding.
   * ตั้งค่าไม่ได้แปลว่าเปิด — เปิดเมื่อผูก token เท่านั้น
   *
   * ⚠️ OPTIONAL so that every existing caller — including three specs written
   * before this feature — keeps compiling and behaving unchanged without a single
   * edit. Absent falls back to the defaults in `strike-suspend.helper.ts`.
   * ของใหม่ต้องไม่บังคับให้ของเดิมแก้ตาม
   */
  suspendAt?: number;
  suspendWindowHours?: number;
}

/**
 * [FIX-20260829-STRIKEENVDEAD] read the knob from env, falling back to the default.
 *
 * 🔴 LAZY, NOT AT IMPORT. `getValidatedEnv()` THROWS until `ConfigModule` has
 *    validated, and this module is imported long before that — reading eagerly
 *    would turn a config lookup into a boot crash. Every consumer reads the
 *    property through `this.cfg.suspendAt` while serving a request, which is
 *    always after boot, so a getter resolves the real value every time.
 * ⚠️ The `catch` is the pre-boot window ONLY (and specs that never boot config).
 *    It must not swallow a bad value: `env.schema.ts` already rejects one at
 *    startup, so anything that reaches here has passed the same range check.
 */
function knob(
  read: (e: ReturnType<typeof getValidatedEnv>) => number,
  fallback: number,
): number {
  try {
    const v = read(getValidatedEnv());
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * [FIX-20260829-STRIKEENVDEAD] `STRIKE_SUSPEND_AT` / `STRIKE_SUSPEND_WINDOW_HOURS`
 * were declared in `env.schema.ts` and then read by NOBODY — these two fields
 * were pinned to the module constants while the comment above claimed they were
 * "resolved from env".
 *
 * 🔴 That was not cosmetic. `suspendPolicy()` feeds the admin panel AND
 *    `shouldSuspendNow()` decides the real lockout from the same field, so a
 *    server configured for 3-strikes-in-1-hour was locking customers at
 *    5-in-24 while showing the wrong numbers on screen. Reported 29/08.
 * 📌 `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS` were checked at the same time
 *    and ARE wired, through `app.config.ts` — which is why the counter in that
 *    same panel was right while the sentence under it was not.
 *
 * Locked by `z-test/unit/strike-suspend-env.spec.ts`.
 * revert: pin these two back to the constants — and the env vars go dead again.
 */
export const STRIKE_TRACKING: StrikeTrackingConfig = {
  enabled: true,
  get suspendAt(): number {
    return knob((e) => e.STRIKE_SUSPEND_AT, DEFAULT_SUSPEND_AT);
  },
  get suspendWindowHours(): number {
    return knob(
      (e) => e.STRIKE_SUSPEND_WINDOW_HOURS,
      DEFAULT_SUSPEND_WINDOW_HOURS,
    );
  },
};

/** Injection token so a spec can hand in a variant; production binds nothing. */
export const STRIKE_TRACKING_CONFIG = Symbol('STRIKE_TRACKING_CONFIG');
