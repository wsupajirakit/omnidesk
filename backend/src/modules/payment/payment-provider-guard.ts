/**
 * ==== [FEAT-20260903-RESUMEPROVIDERGUARD] did the provider change mid-pause? ===
 *
 * A `[ลองใหม่]` retry re-enters the topup leg with the slip that was verified
 * EARLIER. If the hook's slip provider was changed while the run sat paused, the
 * stored envelope is provider A's dialect and the leg would send it with provider
 * B's tool — its path, its params, its `topup_payload_path`. Nothing downstream
 * notices; it breaks remotely, after the money request has gone out.
 *
 * Owner's decision (02/09): **REVIEW, not proceed.** On a money path an unknown
 * outcome is worse than a stopped one. A dead-ended retry an admin can see beats
 * a malformed money request nobody sees.
 *
 * ── 🔴 THE SHAPE IS §9.2's, AND THE PLAIN VERSION BREAKS RULE B ─────────────
 * Recorded before any of it was built (`[PLANAUDIT-20260903-RESUMEVSSTG]`).
 * Comparing the two strings would refuse resumes on a fleet that is working:
 *
 *   1. UNSTAMPED ROWS. Every slip verified before stamping shipped has
 *      `slip_provider` absent. Compared as a value it never equals the current
 *      provider, so EVERY paused retry on an existing slip would dead-end into
 *      review. Absent means "no opinion, proceed" — that is why the Prop has no
 *      default, and the reason has to survive into the comparison.
 *   2. NAME vs IDENTITY. On staging `hook.slip_provider` is `''`, which RESOLVES
 *      to Swiftcheck, while the stamp holds the RESOLVED name `'swiftcheck'`. So
 *      `'swiftcheck' !== ''` on every resume, and the "fix" would be writing the
 *      config value rule B says must never be required.
 *
 * ⇒ BOTH SIDES ARE RESOLVED AND THE PROVIDER IDENTITY IS COMPARED. Then `''`,
 * `'swiftcheck'` and an unregistered typo are the same provider, an untouched
 * staging never sees a mismatch, and the switch still fires for the case it
 * exists for — a real change between two REGISTERED providers.
 * เทียบตัวที่ resolve แล้ว ไม่ใช่สตริงดิบ · ไม่มีตราประทับ = ไม่มีข้อขัดแย้ง
 *
 * ── 🔴 WHY `resolve` IS A PARAMETER AND NOT AN IMPORT CALL ──────────────────
 * With exactly one provider enabled, EVERY value resolves to the same
 * implementation — so the mismatch branch cannot be made true, not even by a
 * test. Shipping it that way would be the thing the registry's own tripwire
 * warns about: a guard nobody can prove works, discovered on the day something is
 * already wrong. Injecting the resolver lets the mismatch branch be driven with a
 * two-provider registry today, while production keeps using the real one by
 * default. สวิตช์ที่อีกด้านไม่เคยทำงาน ไม่ใช่สวิตช์
 *
 * ⚠️ PURE, AND IT DECIDES NOTHING. It answers one question; the caller owns the
 * outcome, the run state and the reply. Keeping the money decision at the call
 * site is what makes this testable without a database.
 *
 * 📄 REF: `docs/slip-spec.md` §9.2 · `payment-runner.service.ts`
 * `[PLANAUDIT-20260903-RESUMEVSSTG]`.
 * revert: delete this file and its call in `_resume`.
 */
import { DEFAULT_SLIP_PROVIDER, resolveSlipProvider } from '@/modules/slip';

/** Anything with an identity — the comparison is by reference, never by name. */
export type ProviderRef = object;

/**
 * Resolve a configured or stamped name to the provider that would actually run.
 * `''`, absent and an unregistered name all land on the default, which is the
 * same rule the verification path follows.
 */
export const resolveForCompare = (name: unknown): ProviderRef =>
  resolveSlipProvider(typeof name === 'string' ? name : '') ??
  DEFAULT_SLIP_PROVIDER;

/**
 * @param stamped `slip_verifications.slip_provider` — who ACTUALLY verified this
 * slip. Absent means the row predates stamping.
 * @param configured `hook.slip_provider` — what the hook says today.
 * @param resolve injected for the reason in the header; defaults to the real one.
 * @returns `true` only when the slip was verified by a provider that is not the
 * one this hook would use now.
 */
export function providerChangedSinceVerification(
  stamped: unknown,
  configured: unknown,
  resolve: (name: unknown) => ProviderRef = resolveForCompare,
): boolean {
  /* 🔴 NO STAMP ⇒ NO OPINION ⇒ PROCEED, and this must come BEFORE resolving.
     Resolving an absent stamp would turn it into the default provider, which is
     an ANSWER — and for a hook configured to a different provider that answer is
     "mismatch", dead-ending every retry on every row written before stamping
     shipped. That is failure mode 1 above, and it survives only if this line
     stays first. */
  if (typeof stamped !== 'string' || stamped.trim() === '') return false;

  return resolve(stamped) !== resolve(configured);
}
