/**
 * [FIX-20260829-STRIKEENVDEAD] STRIKE_SUSPEND_AT / _WINDOW_HOURS were never read
 * ===========================================================================
 * Reported 29/08: the server had `STRIKE_SUSPEND_AT=3` and
 * `STRIKE_SUSPEND_WINDOW_HOURS=1`, and the strike panel kept showing "อีก 5
 * ครั้ง … ภายใน 24 ชม." — the built-in defaults.
 *
 * 🔴 THE TWO VARIABLES WERE DECLARED AND THEN DROPPED. `env.schema.ts` validates
 *    them, so a wrong value is rejected at boot and an operator gets every signal
 *    that the knob works — but `STRIKE_TRACKING` in `strike.config.ts` was built
 *    from the module constants, never from `env()`. The comment above it even
 *    said "resolved from env". Nothing read them anywhere in `src`.
 *
 * 🔴 THIS IS NOT COSMETIC. `suspendPolicy()` feeds the panel AND
 *    `shouldSuspendNow()` decides the real lockout, both from the same field —
 *    so the number on screen was wrong and the customer was being locked at 5
 *    strikes over 24h while the config said 3 over 1h.
 *
 * ⚠️ `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS` were checked at the same time
 *    and are correctly wired through `app.config.ts` — which is why the "0 / 5"
 *    line in the same panel was right while the sentence under it was not.
 *
 * ⚠️ Read at MODULE LOAD, exactly like `rateLimitConfig` does, so the value is
 *    fixed at boot rather than re-read per request. Changing it needs a restart,
 *    which is the same contract as every other knob in this app.
 *
 * revert: put the two module constants back in `STRIKE_TRACKING` and delete this
 *         spec — the env vars go dead again.
 */
import {
  DEFAULT_SUSPEND_AT,
  DEFAULT_SUSPEND_WINDOW_HOURS,
} from '../../src/modules/strike/strike-suspend.helper';

/**
 * Boots the env the same way the app does — `validateEnv` is what `ConfigModule`
 * calls — then reads the config through the SAME accessor production uses, so
 * this cannot pass on a path the server does not take.
 */
const load = (vars: Record<string, string | undefined>) => {
  jest.resetModules();
  const saved = { ...process.env };
  Object.entries(vars).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  try {
    /* the validator checks the WHOLE file, so the unrelated required keys have
       to be present or nothing boots. Placeholders only — no real secret goes
       into a spec, and none of these is read by the code under test. */
    require('../../src/config/env.schema').validateEnv({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/spec',
      JWT_SECRET: 'x'.repeat(32),
      ENCRYPTION_KEY: 'y'.repeat(32),
      ...process.env,
    });

    const cfg =
      require('../../src/modules/strike/strike.config').STRIKE_TRACKING;
    /* read the values HERE, while the env is still in place — the knobs resolve
       lazily so the config object cannot be captured before validation. */
    return {
      enabled: cfg.enabled,
      suspendAt: cfg.suspendAt,
      suspendWindowHours: cfg.suspendWindowHours,
    };
  } finally {
    process.env = saved;
  }
};

describe('[STRIKEENVDEAD] the suspend knobs actually come from env', () => {
  it('⭐⭐ 🔴 STRIKE_SUSPEND_AT=3 reaches the config — it used to stay 5', () => {
    expect(
      load({ STRIKE_SUSPEND_AT: '3', STRIKE_SUSPEND_WINDOW_HOURS: '1' })
        .suspendAt,
    ).toBe(3);
  });

  it('⭐⭐ 🔴 STRIKE_SUSPEND_WINDOW_HOURS=1 reaches it too — it used to stay 24', () => {
    expect(
      load({ STRIKE_SUSPEND_AT: '3', STRIKE_SUSPEND_WINDOW_HOURS: '1' })
        .suspendWindowHours,
    ).toBe(1);
  });

  it('⭐⭐ unset ⇒ the documented defaults, so nobody who set nothing is affected', () => {
    const cfg = load({
      STRIKE_SUSPEND_AT: undefined,
      STRIKE_SUSPEND_WINDOW_HOURS: undefined,
    });
    expect(cfg.suspendAt).toBe(DEFAULT_SUSPEND_AT);
    expect(cfg.suspendWindowHours).toBe(DEFAULT_SUSPEND_WINDOW_HOURS);
  });

  it('⭐ tracking stays on — this change is about WHERE the line is, not whether the gate runs', () => {
    expect(load({ STRIKE_SUSPEND_AT: '3' }).enabled).toBe(true);
  });
});
