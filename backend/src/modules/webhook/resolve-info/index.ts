/**
 * `resolveInfo` — the register of ways to read information out of text.
 * ===========================================================================
 * Owner: "ทำฟังก์ชั่นใหม่แยก ใครเรียกก็ได้เป็นกลาง · resloveInfo ก็จะมีได้หลายฟังก์ชั่น
 * หลายแบบ ทำเป็น function register" · "resloveInfo -> basic register ทำเป็นกลาง
 * เพราะว่าอาจจะมี resloveInfo -> dynamic register เรียกใช้ในอนาคต".
 *
 * ADDING ONE: write `dynamic-register.ts` next to these, export it, and add a
 * line to `INFO_RESOLVERS`. Nothing else changes — not a caller, not a scenario.
 * เพิ่มตัวใหม่ = ไฟล์ใหม่ + หนึ่งบรรทัดที่นี่.
 *
 * ⚠️ NEUTRAL BY CONSTRUCTION. Nothing in this folder imports Nest, LINE, Mongo or
 * the webhook, and nothing in it imports `register/` either — registration is
 * merely today's caller. A cron, a CLI or a test can call `resolveInfo` with a
 * plain array of strings. ไม่ผูกกับใครเลย.
 *
 * ⚠️ RESOLVERS NEVER IMPORT EACH OTHER. This registry is the only place that
 * knows they exist as a set.
 *
 * ## REMOVING THIS FOLDER — steps
 *   1. delete this folder
 *   2. `scenarios/scenario.types.ts` — delete `resolver?`, `ScenarioResolved`
 *      and `ScenarioInput.resolved`, and narrow `endsFlow` back to `boolean`
 *   3. `register.helper.ts` — delete the `resolveInfo(...)` call and the
 *      `typeof scenario.endsFlow === 'function'` branch; `endFlow` becomes the
 *      declared field again
 *   4. `scenarios/scenario-a.ts` — `endsFlow: true`, drop `resolver`, and decide
 *      whether A opens its case unconditionally (that is what it did before)
 *   5. delete `z-test/unit/resolve-info-basic.spec.ts` and the cases in
 *      `register-scenarios.spec.ts` that assert A decides from what it read
 *
 * ⚠️ Removing this changes CUSTOMER-FACING BEHAVIOUR, unlike the folders around
 * it: scenario A stops reading messages, so `found` disappears and with it the
 * owner's rule "ถ้าเจอ true = endflow · ถ้าเจอ false ไม่ end flow". Every level-2
 * message would end the flow again. ถอดตัวนี้ = พฤติกรรมกับลูกค้าเปลี่ยน ไม่เหมือน
 * โฟลเดอร์ข้าง ๆ ที่ถอดแล้วเงียบ.
 *
 * ## PUTTING IT BACK
 * `git revert`, or restore the folder and re-add `resolver: 'basic'` plus the
 * `endsFlow` function to `scenario-a.ts`. Nothing registers this folder — the
 * registry below IS the wiring. เอากลับ = คืนโฟลเดอร์ + 2 บรรทัดใน scenario-a.
 *
 * revert: see "REMOVING THIS FOLDER" above.
 */
export * from './resolve-info.types';
export * from './basic-register';
export * from './dynamic-register';

import { BASIC_REGISTER } from './basic-register';
import { DYNAMIC_REGISTER } from './dynamic-register';
import type {
  InfoResolver,
  ResolveInfoInput,
  ResolvedInfo,
} from './resolve-info.types';

export const INFO_RESOLVERS: Record<string, InfoResolver> = {
  basic: BASIC_REGISTER,
  /* [FEAT-20260820-DYNAMICPARK] Registered so it stays compiled, typed and
     tested — and selected by nothing. It holds the careful rule `basic` used
     until 2026-08-20 (leading zero decides the phone, dashes join, last match
     wins), moved here whole when the owner replaced the live rule with a blunt
     "more than five digits anywhere". Taking it into use is one word in
     `scenarios/scenario-a.ts`: `resolver: 'dynamic'`.
     จอดไว้ · ไม่มีใครเรียก · เปิดใช้ = เปลี่ยนคำเดียว. */
  dynamic: DYNAMIC_REGISTER,
};

/** `null` for a name nobody registered — never a throw on a live conversation. */
export function getResolver(
  name: string | null | undefined,
): InfoResolver | null {
  const key = String(name ?? '')
    .trim()
    .toLowerCase();
  return INFO_RESOLVERS[key] ?? null;
}

/**
 * Run a named resolver over some text.
 *
 * Returns `null` — never throws — when the name is unknown or the resolver
 * itself fails. A caller deciding whether to end a live webhook flow must be
 * able to treat "could not resolve" as an ordinary answer, not an exception it
 * has to catch on the customer's turn. ล้มก็คืน null · ไม่โยน.
 */
export function resolveInfo(
  name: string | null | undefined,
  input: ResolveInfoInput,
): ResolvedInfo | null {
  const resolver = getResolver(name);
  if (!resolver) return null;
  try {
    return resolver.resolve(input);
  } catch {
    return null;
  }
}
