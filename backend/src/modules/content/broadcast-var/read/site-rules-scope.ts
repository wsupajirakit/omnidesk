/**
 * [FEAT-20260903-BCASTOASCOPE] Which site the dictionary should translate FOR,
 * when there is no person to ask.
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock. One switch, one function.
 *
 * 🔴 WHAT THIS ENABLES — AND WHAT IT DOES **NOT** FIX. Read both halves.
 *
 * `buildBroadcastVars` derives the dictionary `scope` from the MEMBER's profile
 * (`build-broadcast-vars.ts` — `profile['web_code']`). That is right for a
 * multicast, where a recipient row is in hand. A `/message/broadcast` has no
 * recipient at all, so the OA path passes `storedProfile: undefined`
 * (`oa-vars.reader.ts`) and the scope came out `null`.
 *
 * ⚠️ A NULL SCOPE DOES NOT BREAK TRANSLATION, and it never did. `scope: null`
 *    on a `translation_dict` row means "the central word, for every site", and
 *    `translate()` ends its tier list on exactly that row
 *    (`translation-dict-cache.service.ts:409-420`). So a broadcast has always
 *    translated fine and always shown the central wording.
 *    ไม่มี scope = ได้คำกลาง แปลออกปกติ ไม่ใช่แปลไม่ได้.
 *
 * The ONE thing a null scope could not do is reach the PER-SITE OVERRIDE tier —
 * a row an admin fills in by hand on the dictionary screen
 * (`omnidesk-console/pages/messaging/TranslationDictList.tsx:419`) so one site
 * words a value differently from the rest. On a broadcast that tier was
 * unreachable, whatever an admin had typed there.
 *
 * 🔴 SO THIS IS AN ENABLER, NOT A REPAIR — and the difference matters to the
 *    next reader. An earlier version of this header called it "the bug this
 *    closes … silent", quoting `build-var-map.ts:86-88`'s *"site-specific words
 *    die silently"*, which reads as "the card was not translating". It was.
 *    The owner caught the overstatement on 03/09. เขียนให้ตรง — ของเก่าไม่ได้พัง.
 *
 * ⚠️ Therefore this changes NOTHING today, by measurement: all 217 rows in
 *    `translation_dict` (`local_db_10_aug_26`, 03/09) carry `scope: null`, so
 *    `hasScopeOverride` is false and the scoped tiers are skipped entirely. The
 *    live send proved the values are identical. It starts mattering the first
 *    time somebody fills that field in.
 *
 * 🔑 WHY THE HOOK COLUMN IS THE RIGHT ANSWER AND NOT A SUBSTITUTE FOR ONE.
 * `hooks.customer_link_web_code` is **the same value the site-rules API was
 * called with** — `custom-tool.service.ts:1303-1305` builds its request identity
 * from that exact column. So translating the reply under that scope is asking
 * the dictionary about the site we actually asked the vendor about, not about a
 * site we guessed. ค่าเดียวกันเป๊ะกับตอนยิง API ไม่ใช่ค่าที่ใกล้เคียง.
 *
 * ⚠️ THIS FILE IS FOR THE OA PATH ONLY. `recipient-vars.reader.ts` deliberately
 *    does NOT call it: on a multicast the member's own `web_code` is the truth,
 *    and a hook-level fallback there would change which dictionary entry a real
 *    person's card resolves to. Broadcast has no such person, which is the
 *    entire reason this exists. อย่าเอาไปใช้กับเส้นรายคน.
 *
 * revert: set the switch below to `false` — every caller then gets `undefined`
 * and the OA path renders byte-for-byte as it did before. Delete the file and
 * its one call site in `oa-vars.reader.ts` to remove it fully.
 */

/** The switch. `false` = no scope on the OA path, exactly as before. */
export const USE_HOOK_WEB_CODE_AS_SCOPE = true;

/**
 * The hook column that carries it. Read from `hook.schema.ts`, not remembered —
 * a guessed column name selects nothing, the scope stays null, and the failure
 * looks identical to the bug this file exists to fix.
 */
export const HOOK_WEB_CODE_COLUMN = 'customer_link_web_code';

/**
 * The dictionary scope for one OA, or `undefined` when there is none.
 *
 * `undefined` and not `null`: `FlexBuildOpts.scope` is optional and the var-map
 * builders read it with `opts.scope ?? …`, so `undefined` is the value that
 * means "nobody set one" all the way down. Never throws — an unreadable hook
 * row costs the scope, not the card.
 */
export function siteRulesScopeOf(
  hook: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!USE_HOOK_WEB_CODE_AS_SCOPE) return undefined;
  const raw = hook?.[HOOK_WEB_CODE_COLUMN];
  if (typeof raw !== 'string') return undefined;
  const code = raw.trim();
  /* An empty column is not a scope. Passing `''` would look set and resolve
     nothing — the same silent miss as the null it replaced. */
  return code === '' ? undefined : code;
}
