/**
 * ==== [FEAT-20260903-TOPUPPERPROVIDER] which Shop-API path this slip goes to =====
 *
 * WHAT: picks the `pay_topup` endpoint record for a slip, allowing a record to be
 * bound to one slip provider while an unbound record keeps serving everybody.
 *
 * WHY IT EXISTS. `shop-api/v1/customer/validate-slip` was written for Swiftcheck's
 * envelope. A second vendor may need its own path on the customer's Shop-API, so a
 * record can now say which provider it serves — owner, 03/09: *"ใช้ตัวเดิมก็ได้
 * จะสร้างเพิ่มแล้วผูก provider กับ path ใหม่ก็ได้"*.
 *
 * 🔴 THE BUG THIS ALSO FIXES, AND IT IS THE REASON A PLAN WAS NEEDED. Selection
 * used to be `endpoints.find(e => e.status !== false && e.role === role)` — the
 * FIRST enabled match. So adding a second `pay_topup` record did **nothing**: the
 * first one won and the new one was dead, silently, with no error and nothing in
 * the dashboard to say so. Selection is by VALUE here, so the order of
 * `endpoints[]` stops carrying meaning. เลือกด้วยค่า ไม่ใช่ด้วยลำดับ
 *
 * ── 🔴 RULE B — SWIFTCHECK IS THE DEFAULT WITH NOTHING CONFIGURED ──────────────
 * No record carries `slip_provider` today, so step 2 below finds nothing and the
 * unbound record is returned — the same object the old `find` returned. Staging
 * sets nothing, changes nothing, and keeps working. That is not a side effect of
 * this shape; it is the requirement it was built around.
 *
 * ⚠️ AND A DISABLED PROVIDER NEEDS NO SPECIAL CASE. The match is against the
 * slip ROW'S STAMP — who actually verified this slip — and a provider that is not
 * enabled can never have stamped a row. So a record bound to a switched-off
 * vendor simply never matches, without this file having to know the registry.
 *
 * ⚠️ THE STAMP, NOT `hook.slip_provider`. A resume can run after the hook's
 * config changed; reading the hook would send a resumed slip down the path of a
 * provider that never touched it.
 *
 * ⚠️ WALLETPAY IS DELIBERATELY NOT ROUTED THROUGH HERE. Owner's decision, 03/09:
 * `pay_walletpay` serves every provider exactly as it does for Swiftcheck. Its body is
 * built from the shared envelope, so there is nothing vendor-shaped to split on,
 * and a second selection path with no caller is the debt this repo keeps undoing.
 * That is why the walletpay call site still uses the plain role lookup — the decision
 * is structural, not a comment somebody can drift from.
 *
 * 📄 REF: `docs/slip-spec.md` §18.
 * revert: delete this file and restore the topup call site to
 * `this.findRole(tool, 'pay_topup')`.
 */

/** Only the fields this reads. Structural, so a Mongoose doc or a plain object
 *  both satisfy it — the same shape `findRole` already accepts. */
export interface EndpointLike {
  role?: unknown;
  status?: unknown;
  slip_provider?: unknown;
}

/**
 * Trim + lower-case, the same normalisation `resolveSlipProvider` applies, so a
 * record saying `SlipGuard` matches a row stamped `slipguard`.
 *
 * ⚠️ ANYTHING THAT IS NOT A STRING BECOMES `''` — i.e. "serves every provider" —
 * rather than being stringified. A provider name is a string; a number or an
 * object in that field is corrupt config, and `String(...)` on it would invent a
 * name like `[object Object]` that could never match and would silently make the
 * record unreachable instead of falling back to the shared one.
 */
const norm = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toLowerCase() : '';

/**
 * @param endpoints the tool's endpoint records.
 * @param role the role to select — `'pay_topup'` here; walletpay does not use this.
 * @param slipProvider the provider stamped on the slip ROW. `''`/absent means an
 * unstamped row (written before the stamp existed), which correctly reaches the
 * unbound record.
 * @returns the record to call, or `null` when no enabled record can serve it.
 *
 * 🔴 RETURNING `null` WHEN ONLY ANOTHER VENDOR'S RECORD EXISTS IS DELIBERATE.
 * The caller treats that as `no_topup_endpoint`: it releases the lock and the
 * customer can resend, with the reason recorded. Calling a path built for a
 * different vendor would be the alternative, and that one moves money through an
 * endpoint nobody pointed at this slip.
 */
export function findTopupEndpoint<T extends EndpointLike>(
  endpoints: readonly T[] | undefined,
  role: string,
  slipProvider: unknown,
): T | null {
  const live = (endpoints || []).filter(
    (e) => e && e['status'] !== false && e['role'] === role,
  );
  if (live.length === 0) return null;

  // 1. a record bound to THIS slip's provider wins
  const wanted = norm(slipProvider);
  if (wanted) {
    const bound = live.find((e) => norm(e['slip_provider']) === wanted);
    if (bound) return bound;
  }

  // 2. otherwise the record that serves everybody — this is the RULE B path and
  //    the one every tool takes today, because nothing sets the field yet
  return live.find((e) => norm(e['slip_provider']) === '') ?? null;
}
