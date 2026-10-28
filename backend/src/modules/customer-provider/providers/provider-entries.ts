/**
 * 📖 DOC: `docs/flow/ticket-and-customer-provider-flow.md` §5 — how to add a provider,
 *    split by what it actually costs: a path table and no code (80%), one of
 *    five named rule shapes a path cannot express (20%), or a new card id the
 *    dashboard already draws generically (5%). Read it before adding a line
 *    here; the cheap case is cheaper than it looks.

 * ==== [FEAT-20260905-CUSTPROV] one line per provider, one word to switch ======
 *
 * 📖 THIS HEADER IS THE GUIDE. It lives in the file you edit to add a provider,
 * not in a `docs/` folder and not in a `.md` (every `*.md` is gitignored here, so
 * a guide written as one would not survive a clone). คู่มืออยู่ในไฟล์ที่ต้องแก้จริง
 *
 * ── 0 · THE ONE RULE EVERYTHING ELSE FOLLOWS ────────────────────────────────
 * 🔴 THIS FILE IS THE ONLY LIST OF VALID PROVIDERS. Not the env schema, not a
 * `z.enum`, not a type union, not a constant in a service, not the front end. If
 * you are about to write a provider name somewhere else, stop: that second place
 * is a copy, and it will disagree with this one.
 *
 * Enforced, not merely asked for — `z-test/unit/customer-provider.spec.ts` fails
 * if any file outside this folder reads `CUSTOMER_PROVIDER` or types `'shopapi_v1'`.
 * Both checks skip comment lines, so explaining the rule does not break it.
 *
 * ── 1 · THE DEFAULT NEEDS NO CONFIGURATION ──────────────────────────────────
 * 🔴 With `CUSTOMER_PROVIDER` unset — nowhere in `.env`, `.env.local`, the
 * container or any runbook — everything behaves exactly as it did before this
 * module existed. That is the acceptance test. If an environment must set a value
 * to keep looking the way it looks today, the default is wrong.
 *
 * ⚠️ Do NOT add the variable to `.env.example` or a deploy template as a value to
 * set. Listing it as required is how "unset" stops being the tested path.
 *
 * ── 2 · HOW TO ADD PROVIDER B ───────────────────────────────────────────────
 *
 * 🔴 START BY ASKING WHICH KIND OF VENDOR YOU HAVE. The answer decides whether
 * you write data or code, and most vendors are the first kind.
 *
 * (a) THE COMMON CASE — same ideas, different field names. Write a path table
 *     and NO code:
 *       1. `providers/<key>/field-paths.ts` — copy `shopapi-v1/field-paths.ts` and
 *          repoint the paths at your vendor's names;
 *       2. `providers/<key>/index.ts` — `paths: <YOUR>_PATHS` and
 *          `deriveFields: deriveShopapiV1Fields` (yes, reuse it: the nine
 *          algorithms are about the SHAPES of values, not about a vendor);
 *       3. add ONE line to `CUSTOMER_PROVIDER_ENTRIES` below;
 *       4. write `z-test/unit/customer-provider-<key>.spec.ts` with real vectors.
 *     `customer-provider-fields.spec.ts` proves this path works by doing exactly
 *     it — a second provider whose only difference is its table.
 *
 * (b) THE ODD CASE — a value nobody else computes that way. Write your own
 *     `derive-fields.ts` too. Read `shopapi-v1/derive-fields.ts` first: it lists why
 *     each of its nine is code rather than a path, and if yours does not match
 *     one of those reasons, it is probably a path.
 *
 * ⚠️ NEVER COPY THE ENGINE. `providers/engine/` holds the path reader and the
 * time helpers precisely so a second provider does not carry its own. A
 * `<key>/read-path.ts` is two readers free to disagree — the trap
 * `member-tier-key.util.ts` already documents. helper ร่วมอยู่ที่ engine ห้ามก๊อป
 *
 * Nothing else: no route, no controller, no DTO, no front-end file, no i18n key,
 * no migration, no dashboard release.
 *
 * ⚠️ Do NOT write a test that asserts how many entries exist. A spec that fails
 * when a provider is added turns a one-line change into a two-file one, which is
 * the cost this design exists to remove.
 *
 * ── 3 · HOW TO SERVE IT ─────────────────────────────────────────────────────
 *   CUSTOMER_PROVIDER=acme_v1   then restart. No rebuild, no FE release.
 *
 *   unset / '' / whitespace → the default, SILENTLY (the normal path)
 *   a known name            → that entry, one LOG line
 *   an unknown name         → the default, one WARN naming BOTH values
 *
 * A typo never takes the process down. `MembersService.stamped()` puts the
 * RESOLVED name on every profile and site-rules response, so the log and the
 * screen cannot disagree about what answered.
 *
 * ── 4 · WRITING YOUR OWN SCENARIO ───────────────────────────────────────────
 * MAY vary: where every value lives (`paths` — the container, the sections and
 * one chain per field) · where the tier lives (`tierPaths`, in order, truthy
 * wins) · whether the tier badge shows · whether the tier filter shows · the nine
 * algorithms, if and only if your vendor genuinely computes one differently.
 *
 * 🔴 MAY NEVER vary: the route, the HTTP method, the permission, the scoping, the
 * refresh cooldown, the cache, the error envelope, or the stored
 * `raw_profile_data` itself. One door in, one door out; only the answer varies. A
 * provider that could change those would be a second system to operate rather
 * than a second answer. ทางเข้าทางออกเหมือนกัน ต่างกันแค่คำตอบ
 *
 * ⚠️ The truthy gate on `tierPaths` is load-bearing: `''`, `0` and `false` fall
 * through to the next path and finally to the `member.tier` column. That is the
 * exact behaviour of the dashboard's `utils/memberTier.ts` and its back-end port
 * (`member-tier-key.util.ts:38-48`), and changing it moves a badge on screen. If
 * your site uses `level: 0` for its lowest tier, that `0` is meaningful and your
 * entry needs a spec vector proving it survives.
 *
 * TWO CHECKS BEFORE SHIPPING AN ENTRY:
 *   · open a REAL row (`mongosh`, print `raw_profile_data`) and confirm the path
 *     resolves. A path guessed from code compiles, reviews clean, renders nothing.
 *   · diff against `shopapi_v1`. If it is identical, you do not need a provider.
 *
 * ── 4b · WHAT IT TOUCHES, ON EACH SIDE ──────────────────────────────────────
 *
 * BACK END — everything a provider needs is here. Adding one touches:
 *   `providers/<key>/field-paths.ts` NEW   where its values live (DATA)
 *   `providers/<key>/index.ts`       NEW   the entry
 *   `providers/<key>/derive-fields.ts` NEW, ONLY for case (b) above
 *   `provider-entries.ts`            +1    this list
 *   `z-test/unit/…<key>.spec.ts`     NEW   its proof
 * and NOTHING else. In particular it does NOT touch `members.service.ts`: that
 * file asks the resolver and stamps the answer through ONE helper
 * (`stamped()`), so a new provider is invisible to it.
 *
 * WHERE THE VALUE COMES OUT — three responses, six branches, one helper:
 *   GET    /api/line-users/:id/raw-profile
 *   POST   /api/line-users/:id/raw-profile/refresh     (cooldown + success)
 *   GET    /api/hooks/:hookId/site-rules               (3 branches)
 * each answers `{ …, customer_provider: "<name>" }`. Additive: `data` is the
 * stored blob byte for byte, and a client that ignores the key behaves as before.
 *
 * FRONT END — 🔴 IT HOLDS NO PROVIDER LIST, AND MUST NOT LEARN ONE.
 *   · It reads what the provider DECIDED, never the provider's NAME: the per-switch
 *     stamps (`show_tier_badge`, `show_follow_ups`, `show_register_action`,
 *     `show_walletpay_card`, `has_member_data` — `utils/tierSwitches.ts`,
 *     `services/chat/ticketService.ts`, `ProfilePanel.tsx`, `Contact.tsx`) and the
 *     `view`. [FIX-20261014-STAMPDOC] An earlier version of this line named a reader
 *     `services/customerProvider.ts` for `customer_provider` — no such file exists, and
 *     no FE source reads that key (checked 14/10; only two tests mention it). Never
 *     `import.meta.env` — Vite inlines those at BUILD time, so an FE-side flag could
 *     only change with a rebuild and a redeploy, which is the whole thing this design
 *     removes.
 *   · The panel and the room header render from what the payload describes. They
 *     switch on section TYPE, never on a provider name — so the front end has no
 *     list that can drift out of step with this file.
 *   · An unknown value ⇒ the default rendering, plus a visible labelled
 *     fallback. Never a blank space: a silent gap becomes a support ticket
 *     instead of a bug report.
 *
 * ⇒ ADDING PROVIDER B IS A BACK-END-ONLY CHANGE. No FE file, no FE release.
 *   เพิ่ม provider ไม่ต้องแตะหน้าบ้านเลย
 *
 * ── 4c · WHAT BREAKS IF ONLY ONE SIDE SHIPS ─────────────────────────────────
 *   BE alone → the response gains a key nothing reads. Nothing changes. Safe.
 *   FE alone → 🔴 EVERY MONEY VALUE ON THE PANEL GOES BLANK. NOT safe.
 *
 * 🔴 [FIX-20260906-RELEASEORDER] THIS BLOCK USED TO SAY "either order, no coordinated
 * release", and that stopped being true the moment the panel started drawing from the
 * provider view. `ProfilePanel` reads `readPanelValues(rawProfile?.view)`; with no
 * `view` on the wire that reader is EMPTY, every `pv.value(...)` answers `undefined`,
 * and a linked customer holding real credit sees `-` in every field. The old inline
 * reads were replaced, not kept beside it, so there is nothing to fall back to. It is
 * not theoretical: the same empty reader blanked a real customer's panel on 06/09 when
 * `ticketService` parsed `view` off the wire and dropped it one line later.
 *
 *   ⇒ THE ORDER IS FIXED: **BE first, then FE.** And never roll the BE back on its own
 *     while the new FE is live — same failure, same blank panel.
 *     ต้องขึ้น BE ก่อน FE เสมอ · ถอย BE ตัวเดียวไม่ได้
 *
 *   "Either order is safe" becomes true again only once the FE carries a fallback for
 *   an absent `view`. It does not today.
 *
 * ── 4d · WHAT A PROVIDER CANNOT REACH, EVEN THOUGH IT LOOKS NEARBY ──────────
 * These render beside the panel and the header and belong to OTHER owners. A
 * provider must never hide or alter them:
 *   · the quota gauge (`HeaderQuotaGauge`) — it is the OA push balance
 *   · the close-case control — ticket state; hiding it strands an operator
 *   · AA (font scale) and search — accessibility and navigation
 *   · รอทำรายการ and ผู้ดูแลปัจจุบัน — ticket/room state, not profile data
 * A provider variant that seems to need one of these is a signal the boundary is
 * wrong. Stop and re-cut it; do not add a switch.
 *
 * ── 5 · SHAPE ───────────────────────────────────────────────────────────────
 * Lifted from `src/modules/slip/providers/`, which answered the same owner
 * request for slip vendors on 03/09. If anything here is unclear, that folder is
 * the same idea with a second entry already in it.
 *
 *     add a new one  →  a folder and ONE line here. No other entry is touched.
 *     switch         →  `CUSTOMER_PROVIDER=<name>` and restart.
 *     remove one     →  delete its line and its folder.
 *
 * 🔴 THE KEY IS `provider.name`, NOT A STRING TYPED HERE. Writing
 * `shopapi_v1: shopapiV1Provider` would state the same fact twice and let the two
 * drift. Same rule, same reason, as the slip registry.
 *
 * ⚠️ NO `enabled` FLAG, unlike slip. Slip needs one because a hook STORES a
 * provider name an operator picked from a dropdown, so a value can be written
 * that the runtime must refuse. Here the value is an environment variable set by
 * whoever deploys: no picker, nothing stored, so an "off but present" state would
 * be a mechanism with no caller. Add it the day a provider ships dark.
 *
 * revert: delete this file with the rest of `src/modules/customer-provider/`.
 */
import type { CustomerProvider } from './customer-provider.port';
import { loanV1Provider } from './loan-v1';
import { shopapiV1Provider } from './shopapi-v1';

/** Every provider that exists. One line each. */
export const CUSTOMER_PROVIDER_ENTRIES: readonly CustomerProvider[] = [
  shopapiV1Provider,
  /* [FEAT-20260907-LOANV1PROVIDER] selected only by CUSTOMER_PROVIDER=loan_v1
     (the loan-site deployment). Everywhere else: dead code — the default
     below stays shopapi_v1 and no screen moves. */
  loanV1Provider,
];

/**
 * What an unset `CUSTOMER_PROVIDER` resolves to, and what an unknown value falls
 * back to.
 *
 * 🔴 Named here rather than typed as a string anywhere else, so "the default" has
 * exactly one definition. It is `shopapi_v1` because that entry IS the current
 * behaviour — the default is not a choice, it is the status quo written down.
 */
export const DEFAULT_CUSTOMER_PROVIDER = shopapiV1Provider;

/**
 * name → provider, built from the entries so the map cannot disagree with them.
 *
 * Exported as a pure function (rather than a pre-built constant) so a spec can
 * drive it with a modified list — the same reason the slip registry does it.
 */
export function buildCustomerProviderRegistry(
  entries: readonly CustomerProvider[] = CUSTOMER_PROVIDER_ENTRIES,
): ReadonlyMap<string, CustomerProvider> {
  const map = new Map<string, CustomerProvider>();
  for (const entry of entries) {
    map.set(entry.name, entry);
  }
  return map;
}
