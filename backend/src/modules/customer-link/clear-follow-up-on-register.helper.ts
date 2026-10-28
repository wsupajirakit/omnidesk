/**
 * A customer who registered is not stuck any more — take the mark off.
 * ===========================================================================
 * [FEAT-20260820-CLEARONLINK] Owner: "เพิ่มเงื่อนไขตอนลงทะเบียนเสร็จ cus link >
 * ไม่ว่าจะ admin กดหรือกดมาเองผ่าน liff · ถ้าสำเร็จ เคลียร์ member follow up".
 *
 * WHAT IT DOES
 *   Removes the follow-up marks that mean "this customer ignored the
 *   registration card", at the moment a link is successfully created. Both ways
 *   of registering reach the one call site (`customer-link.service.ts`), so the
 *   admin pressing the button and the customer filling in the LIFF form are
 *   treated identically — which is right: the mark describes the customer, not
 *   who helped them.
 *
 * WHY IT EXISTS WHEN THE WEBHOOK ALREADY CLEARS THEM
 *   The webhook's follow-up gate clears the same mark, but only on the NEXT
 *   event from that customer — which may be hours away, or never. Until then the
 *   customer counts as stuck to anything that reads the mark, and a registration
 *   that just succeeded is exactly when that is most obviously wrong. The two
 *   clears are complementary, not duplicated: this one is immediate, the gate is
 *   the safety net. Both are `$unset`, so running both is harmless.
 *   ล้างทันทีตรงนี้ · gate เป็นตาข่ายรอบถัดไป · ซ้ำกันได้ไม่พัง.
 *
 * ⚠️ WHAT IT MUST NEVER TOUCH
 *   `follow_up.line.request_reg_at` — the record of "a case was opened asking
 *   this customer to register". Owner: "request_reg_at = ห้ามเคลียร์ห้ามยุ่ง >>>
 *   คงค่าเดิม". That key answers a historical question and survives registration
 *   on purpose. The list below is explicit and is the only thing this file will
 *   ever remove; a test asserts the record key is not in it.
 *
 * ⚠️ SEAMLESS BY CONSTRUCTION
 *   `$unset` on a path a member does not have matches nothing and modifies
 *   nothing — no write, no error, no document rewritten. A member who was never
 *   marked is untouched by this running on every single registration.
 *   คนที่ไม่มีค่าพวกนี้ไม่ถูกแตะแม้แต่ไบต์เดียว.
 *
 * ⚠️ ONE LEAF AT A TIME. `clearMemberConfig` unsets a single dotted path, so a
 *   sibling key under `member.config` that belongs to another feature survives.
 *
 * ⚠️ BEST-EFFORT, NEVER THROWS. The link already exists upstream by the time this
 *   runs. A failure to tidy a mark must never turn a successful registration into
 *   an error — the same rule `registration-stamp.helper.ts` states beside it.
 *
 * ## HOW TO REMOVE THIS ENTIRELY — the exact steps, verified 2026-08-20
 *
 * Executed on this tree, typechecked, and run: `tsc` clean, and the only red
 * suites were the two that assert this feature (steps 4 and 5). An earlier
 * version of this note said "delete the file and one call" — that was wrong and
 * left two suites failing. These five are the real list.
 * ทดลองถอดจริงแล้ว · ของเดิมเขียนไว้ 3 ขั้น ไม่ครบ.
 *
 *   1. delete this file
 *   2. delete `z-test/unit/clear-follow-up-on-register.spec.ts`
 *   3. `customer-link.service.ts` — delete its import and the one
 *      `void clearFollowUpOnLinkRegistered(...)` call inside the
 *      `if (res?.ok && userId)` block
 *   4. `z-test/unit/customer-link-reg-source.spec.ts` — delete the two cases
 *      that assert the clear happens ("the follow-up mark is cleared on the same
 *      success", one per registration path).
 *      ⚠️ KEEP the `stampOf()` helper there. It replaced a `toHaveLength(1)`
 *      count that broke when this feature added a second write; with the feature
 *      gone the count would work again, but looking for the write you mean is
 *      correct either way and survives the next writer.
 *   5. `z-test/unit/member-config.spec.ts` — drop this file from the
 *      "ONE feature reads the bag" reader list.
 *
 * ## WHAT REMOVAL LEAVES BEHIND — and why nothing breaks
 * Nothing. No module wiring, no schema, no config. Customers who register go
 * back to having the mark cleared on their NEXT message by the webhook's own
 * follow-up gate instead of immediately — which is exactly the behaviour before
 * this existed. Marks already removed stay removed.
 * ระบบกลับไปเป็นเหมือนเดิมเป๊ะ ไม่มีอะไรค้าง.
 *
 * ## INDEPENDENT OF THE WEBHOOK'S FOLLOW-UP FEATURE — verified both directions
 * This file imports `chat/config` and nothing from `webhook/follow-up/`, so the
 * two remove in either order and neither notices:
 *   · removed this, left the webhook feature → its suites stayed green
 *   · removed the whole webhook feature (`follow-up/` + `register/` deleted),
 *     left this → this file's 15 cases stayed green
 * The only shared thing is the KEY STRING, and `clearMemberConfig` throws on a
 * key `MEMBER_CONFIG_KEYS` does not declare — so if that feature's keys are ever
 * dropped from the registry too, this file fails loudly on the next
 * registration rather than silently clearing nothing. A test pins that link.
 * ถอดสลับกันได้ทั้งสองทาง · พิสูจน์มาแล้วทั้งคู่.
 *
 * ## PUTTING IT BACK
 * `git revert` the commit, or restore this file and re-add the one call beside
 * `stampLinkRegistration`. There is nothing else — no provider to register, no
 * module to import. เอากลับ = คืนไฟล์ + ใส่ call กลับที่เดิม จบ.
 *
 * revert: see "HOW TO REMOVE" above.
 */
import type { Model } from 'mongoose';

/* Relative, not `@/modules/chat/config`: the alias form is a layering error the
   linter rejects, and this is the same path `webhook/follow-up/` already uses to
   reach the shared member-config helpers. */
/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
   TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.

   THIS FILE CLEARS `follow_up.line.abandon_trigger_at` on the CUSTOMER-LINK path.
   It names the path as a literal rather than importing the constant, because
   folder rule 8 forbids `customer-link/` and `webhook/follow-up/` importing each
   other. That is correct, not a shortcut — but it means a key rename is a
   two-place edit, so grep the PATH, not the constant name.

   That file is the only place a key may be declared, it carries the checklist
   for adding one, the measured index/query rules, and a CONSUMERS list naming
   every file that touches the bag — this one included. `member-config.spec.ts`
   greps the code and fails if that list stops matching reality, so the two
   cannot drift apart silently.
   ⚠️ CHANGING WHAT THIS FILE DOES WITH A KEY MEANS UPDATING THAT LIST in the
   same commit — adding a read, dropping a write, moving to another key.
   แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางด้วยเสมอ.

   ── BOTH ENDS ─────────────────────────────────────────────────────────────
   CLEARS `follow_up.line.abandon_trigger_at` — WHOSE? the flag written by
   `webhook/follow-up/abandon-trigger.helper.ts`, read by that folder's gate.
   This file owns neither; it removes the mark when the CUSTOMER-LINK route
   completes a registration.
   ⚠️ THE OTHER ROUTE HAS ITS OWN CLEARER:
   `webhook/follow-up/clear-follow-up.helper.ts` handles the webhook path.
   ⚠️ It clears ONE leaf by dot-path — another feature's key in the same bag is
   out of reach from here by construction, not by care. */
import { clearMemberConfig } from '../chat/config';

/**
 * The marks a successful registration removes. Explicit, and deliberately short.
 *
 * ⚠️ ADDING A KEY HERE MEANS A REGISTRATION WILL ERASE IT. Only put a key here
 * if it answers "is this customer stuck right now" — never one that answers
 * "what happened to this customer", which must outlive the registration.
 * `clearMemberConfig` throws on a key nobody declared in `MEMBER_CONFIG_KEYS`,
 * so a typo here fails loudly rather than silently clearing nothing.
 */
export const FOLLOW_UP_KEYS_CLEARED_ON_REGISTER = [
  'follow_up.line.abandon_trigger_at',
  /* ⚠️ `follow_up.line.request_reg_at` IS DELIBERATELY ABSENT — it is a RECORD,
     not a flag, and nothing in the system clears it: not this list, not the
     webhook clearer (`webhook/follow-up/clear-follow-up.helper.ts`), not even
     unlinking (`customer-link.service.ts` unsets columns, never the config bag).
     Owner: "request_reg_at = ห้ามเคลียร์ห้ามยุ่ง คงค่าเดิม".
     Both ends are recorded in the CONSUMERS table in
     `src/modules/chat/config/member-config.registry.ts`. */
] as const;

export interface ClearFollowUpOnRegisterDeps {
  memberModel: Model<Record<string, unknown>>;
  warn: (msg: string) => void;
}

/**
 * @returns true when at least one mark was actually removed.
 */
export async function clearFollowUpOnLinkRegistered(
  input: { channelUserId: string },
  deps: ClearFollowUpOnRegisterDeps,
): Promise<boolean> {
  const channelUserId = String(input?.channelUserId ?? '');
  if (!channelUserId) return false;
  try {
    let cleared = false;
    for (const key of FOLLOW_UP_KEYS_CLEARED_ON_REGISTER) {
      cleared =
        (await clearMemberConfig({ line_user_id: channelUserId }, key, {
          memberModel: deps.memberModel,
        })) || cleared;
    }
    return cleared;
  } catch (err) {
    deps.warn(
      `[CUSTOMER-LINK] follow-up clear skipped: ${(err as Error).message}`,
    );
    return false;
  }
}
