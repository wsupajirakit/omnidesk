/**
 * Config checks that legacy runs in `customToolSchema.pre("validate")`
 * (legacy-api/src/models/hook/customToolModel.js:416-472).
 *
 * ⚠️ V8 — SCHEMAS ALONE DO NOT CARRY WRITE BEHAVIOUR. The ported
 * `custom-tool.schema.ts` has every field but none of these rules, so without
 * this file a create/update would accept configs the legacy backend rejects:
 * two login endpoints, a duplicate key, a cached profile endpoint. Reads would
 * still look right and writes would silently diverge — which is precisely the
 * failure mode V8 describes.
 *
 * Legacy throws a plain Error inside a Mongoose `pre("validate")`, which the
 * controller catches and answers as 400 `{error: <message>}`. Throwing the same
 * message from the service and letting the controller's 400 path handle it
 * produces a byte-identical response. The messages are Thai and are shown to
 * the operator verbatim, so they are copied exactly rather than translated.
 */

import { TOOL_CATEGORIES } from './custom-tool-normalize';

export interface ValidatableEndpoint {
  key: string;
  is_login: boolean;
  is_refresh: boolean;
  is_profile: boolean;
  require_jwt: boolean;
  status: boolean;
  role: string;
  cache_ttl_sec?: number | null;
}

/**
 * Throws with legacy's exact message on the first rule that fails.
 *
 * Order matters: legacy evaluates these in sequence and returns only the first
 * failure, so a config breaking two rules must report the earlier one.
 */
export function assertCustomToolConfig(
  authType: string,
  endpoints: ValidatableEndpoint[],
  category?: string,
): void {
  // [FEAT-20260808-PAYTOOL-P1] The tool-level category must be a recognised
  // value. `undefined` = caller omitted it ⇒ the schema default `'generic'`
  // applies, so existing generic tools never reach this throw. Config-driven
  // (TOOL_CATEGORIES) — NO branching on the payment leg names here; the ordered
  // pay_topup/pay_walletpay rules are Phase 2. revert: delete this block + param.
  if (category !== undefined && !TOOL_CATEGORIES.includes(category as never)) {
    throw new Error(
      `category ไม่ถูกต้อง: ${category} (ต้องเป็น ${TOOL_CATEGORIES.join(' | ')})`,
    );
  }

  // 1) Duplicate keys — `find()` would return the first and lose the rest with
  //    no error, so an endpoint would simply stop being callable.
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    const key = String(endpoint.key || '').toUpperCase();
    if (!key) throw new Error('endpoint ต้องมี key');
    if (seen.has(key)) {
      throw new Error(`endpoint key ซ้ำ: ${key} (ห้ามซ้ำภายใน tool เดียวกัน)`);
    }
    seen.add(key);
  }

  // 2/3/3b) At most one endpoint may carry each of these flags — with two, the
  //         caller cannot know which one to use.
  const logins = endpoints.filter((e) => e.is_login);
  if (logins.length > 1) {
    throw new Error(
      `มีเส้น login มากกว่า 1 (${logins.map((e) => e.key).join(', ')})`,
    );
  }
  const refreshes = endpoints.filter((e) => e.is_refresh);
  if (refreshes.length > 1) {
    throw new Error(
      `มีเส้น refresh มากกว่า 1 (${refreshes.map((e) => e.key).join(', ')})`,
    );
  }
  const profiles = endpoints.filter((e) => e.is_profile);
  if (profiles.length > 1) {
    throw new Error(
      `มีเส้นที่ติดธง is_profile มากกว่า 1 (${profiles.map((e) => e.key).join(', ')})`,
    );
  }

  // Caching a per-customer response would serve one customer another's data.
  for (const endpoint of endpoints) {
    const ttl = Number(endpoint.cache_ttl_sec);
    if (!ttl) continue; // null / 0 / NaN = not cached
    if (endpoint.is_profile || endpoint.role === 'profile') {
      throw new Error(
        `ห้ามตั้ง cache_ttl_sec กับเส้นโปรไฟล์ (${endpoint.key}) — ข้อมูลต่อลูกค้าต้องสดเสมอ`,
      );
    }
  }

  const siteRules = endpoints.filter((e) => e.role === 'site_rules');
  if (siteRules.length > 1) {
    throw new Error(
      `มีเส้น role = site_rules มากกว่า 1 (${siteRules.map((e) => e.key).join(', ')})`,
    );
  }

  // 4) jwt_login with endpoints that need a token but nothing to obtain one:
  //    every such call would fail at runtime with no way to tell why.
  if (authType === 'jwt_login' && endpoints.length > 0 && logins.length === 0) {
    const needsJwt = endpoints.some((e) => e.require_jwt && e.status !== false);
    if (needsJwt) {
      throw new Error(
        'auth_type = jwt_login และมี endpoint ที่ require_jwt แต่ไม่มีเส้นที่ติดธง is_login',
      );
    }
  }
}
