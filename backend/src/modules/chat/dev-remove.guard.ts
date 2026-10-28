/**
 * ⚠️⚠️ [TEST-20260820-DEVREMOVE] A TESTING TOOL'S ONLY REAL LOCK ⚠️⚠️
 * ===========================================================================
 * One question: may this caller wipe a customer's stored profile?
 *
 * ## WHAT IT PROTECTS
 * `clearRawProfile` unsets `raw_profile_data`, and that field is what the whole
 * system reads to decide whether a customer is REGISTERED. Wiping it sends them
 * back to "never registered": the follow-up flow starts chasing them, the bot
 * treats them as unlinked, the dashboard shows an empty profile. Useful on a
 * developer's own test account, catastrophic on a real one.
 * ลบแล้วลูกค้ากลับไปเป็น "ยังไม่ลงทะเบียน" ทั้งระบบ.
 *
 * ## WHY IT IS ON THE SERVER
 * The dashboard hides the button for everyone but `dev`. Hiding is decoration:
 * devtools can unhide it, and `curl` never saw it in the first place. The
 * username here comes from the JWT the auth guard already verified — a signed
 * HttpOnly cookie the browser cannot forge — so THIS is the line that decides.
 * ซ่อนปุ่มไม่ใช่การป้องกัน · ด่านจริงอยู่ไฟล์นี้.
 *
 * ## TURNING IT ON AND OFF — no code change needed
 *
 *   ON, today          `DEV_REMOVE_USERNAMES` unset ⇒ falls back to `dev` alone
 *   WIDEN              `DEV_REMOVE_USERNAMES=dev,dev2`
 *   ⭐ OFF for prod     `DEV_REMOVE_USERNAMES=` (empty)
 *                      An empty list matches nobody — every caller gets 403,
 *                      `dev` included. The route stays mounted, the FE keeps
 *                      hiding the button, nothing else moves.
 *   ปิดสนิท = ตั้งค่าว่าง ไม่ต้อง deploy โค้ด.
 *
 * ⚠️ THE FALLBACK IS THE RISK TO KNOW ABOUT. With the variable absent this
 * allows `dev`. That is deliberate for a developer machine and WRONG for
 * production — a prod deploy must set the variable to empty explicitly. It is
 * not defaulted to empty because a silent default would make the tool look
 * broken on the machine it exists for. ตั้ง env ให้ว่างก่อนขึ้น prod เสมอ.
 *
 * ## REMOVING THE TOOL ENTIRELY
 *   1. delete this file
 *   2. delete the `assertDevRemoveAllowed(auth)` call + its doc block in
 *      `members.service.ts` (`clearRawProfile`)
 *   3. delete `DEV_REMOVE_USERNAMES` from `src/config/env.schema.ts`
 *   4. delete `z-test/unit/dev-remove-guard.spec.ts`
 *   5. in `omnidesk-console/components/member/PersonalPanel.tsx` put the button
 *      back behind `{false && (` — the marker there explains how
 * The route then behaves exactly as before 2026-08-20: permission-only.
 *
 * revert: see "REMOVING THE TOOL ENTIRELY" above.
 */
import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedUser } from '@/common';

/** Who may use it when the environment says nothing. A developer machine. */
export const DEV_REMOVE_DEFAULT_USERNAMES = ['dev'] as const;

/**
 * The allowlist, resolved per call so a changed environment takes effect on the
 * next request instead of the next restart.
 *
 * ⚠️ An EMPTY STRING is not "unset" — it is an explicit empty list, and it is
 * how the tool is switched off. Only an ABSENT variable falls back to the
 * default. `''` กับ "ไม่ตั้ง" ต่างกัน: ว่าง = ปิด · ไม่ตั้ง = ใช้ค่า default.
 */
export function devRemoveUsernames(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.DEV_REMOVE_USERNAMES;
  if (raw === undefined) return [...DEV_REMOVE_DEFAULT_USERNAMES];
  return raw
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Throw unless this caller is on the list.
 *
 * ⚠️ Called BEFORE any lookup of the target, so a refusal cannot leak whether a
 * member id exists, and cannot depend on which OAs the caller can see.
 *
 * The message names the tool rather than the list: an operator who hits this by
 * accident should learn it is a developer tool, not learn who is on it.
 */
export function assertDevRemoveAllowed(
  auth: AuthenticatedUser | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const allowed = devRemoveUsernames(env);
  const who = String(auth?.username ?? '')
    .trim()
    .toLowerCase();
  /* No separate "is there a session" check: `devRemoveUsernames` filters empty
     entries out, so the list can never contain `''` and a missing session
     therefore fails `includes` on its own. A `!who ||` term was here first and
     no test could kill it — a line that cannot change an outcome is a line that
     hides one. ไม่มี session ก็ตกด่านนี้เองอยู่แล้ว · เช็คซ้ำฆ่าไม่ได้ = ถอดทิ้ง. */
  if (!allowed.includes(who)) {
    throw new ForbiddenException(
      'clearing a stored profile is a developer testing tool and is not available to this account',
    );
  }
}
