import { registerAs } from '@nestjs/config';

import { getValidatedEnv } from './env.schema';

/**
 * Typed config slices.
 *
 * Modules inject the narrow slice they need (`ConfigType<typeof redisConfig>`)
 * instead of reaching into the raw env object, so a module's dependencies are
 * visible in its constructor and a renamed variable breaks compilation rather
 * than production.
 *
 * Values come from the zod-validated object, never `process.env` directly —
 * numbers and booleans arrive as real numbers and booleans instead of strings.
 */

const env = getValidatedEnv;

export const coreConfig = registerAs('core', () => ({
  nodeEnv: env().NODE_ENV,
  port: env().PORT,
  baseUrl: env().BASE_URL,
  publicBaseUrl: env().PUBLIC_BASE_URL,
  siteName: env().SITE_NAME,
  isProduction: env().NODE_ENV === 'production',
  debug: env().DEBUG,
  devMode: env().DEV_MODE,
  bootstrapTimeoutMs: env().BOOTSTRAP_TIMEOUT_MS,
}));

export const mongoConfig = registerAs('mongo', () => ({
  uri: env().MONGODB_URI,
}));

export const redisConfig = registerAs('redis', () => ({
  host: env().REDIS_HOST,
  port: env().REDIS_PORT,
  username: env().REDIS_USER,
  password: env().REDIS_PASSWORD,
  db: env().REDIS_DB,
  connectTimeoutMs: env().REDIS_CONNECT_TIMEOUT_MS,
}));

export const authConfig = registerAs('auth', () => ({
  jwtSecret: env().JWT_SECRET,
  jwtExpiresIn: env().JWT_EXPIRES_IN,
  // [FIX-20260820-SESSIONCEILING] 0 = off. See env.schema.ts.
  sessionMaxLifetimeMin: env().SESSION_MAX_LIFETIME_MIN,
  encryptionKey: env().ENCRYPTION_KEY,
  tempKeySecret: env().TEMP_KEY_SECRET,
}));

export const httpConfig = registerAs('http', () => ({
  corsAllowedOrigins: env().CORS_ALLOWED_ORIGINS,
  // [FEAT-20260813-PROXYGATE] unset = proxy gate OFF (see proxy-gate.middleware.ts)
  internalProxySecret: env().INTERNAL_PROXY_SECRET,
}));

/**
 * [FEAT-20260808-HTTPONLY-S1] Auth cookie attributes, per-environment.
 *
 * The JWT is set as an HttpOnly + Secure + SameSite cookie on login/refresh, in
 * ADDITION to the existing body token and X-Auth-Key header — Bearer clients are
 * untouched. `domain` empty ⇒ host-only (local); `secure`/`sameSite` follow env.
 *
 * DB-EFFECT: none — a cookie is client-side state, nothing is written to Mongo.
 */
export const cookieConfig = registerAs('cookie', () => ({
  domain: env().COOKIE_DOMAIN,
  secure: env().COOKIE_SECURE,
  sameSite: env().COOKIE_SAMESITE,
}));

export const rateLimitConfig = registerAs('rateLimit', () => ({
  globalEnabled: env().RATE_LIMIT_GLOBAL_ENABLED,
  globalMax: env().RATE_LIMIT_GLOBAL_MAX,
  globalWindowSeconds: env().RATE_LIMIT_GLOBAL_WINDOW_SECONDS,
  // [FEAT-20260826-RLSHADOW] โหมดวัด — นับแต่ไม่ปฏิเสธ (อ่านตอน boot เหมือนตัวอื่น)
  globalShadow: env().RATE_LIMIT_GLOBAL_SHADOW,
  defaultMax: env().RATE_LIMIT_MAX,
  defaultWindowSeconds: env().RATE_LIMIT_WINDOW_SECONDS,
  loginMax: env().RATE_LIMIT_LOGIN_MAX,
  loginWindowSeconds: env().RATE_LIMIT_LOGIN_WINDOW_SECONDS,
  // [FEAT-20260823-LOGINFAIL] แกนที่ 2 — เฉพาะรหัสผิด ต่อ IP
  loginFailEnabled: env().RATE_LIMIT_LOGIN_FAIL_ENABLED,
  loginFailMax: env().RATE_LIMIT_LOGIN_FAIL_MAX,
  loginFailWindowSeconds: env().RATE_LIMIT_LOGIN_FAIL_WINDOW_SECONDS,
  // [FEAT-20260823-LOGINUSER] ชั้น username — ตัวเลขอิสระจากชั้น IP ข้างบน
  loginUserEnabled: env().RATE_LIMIT_LOGIN_USER_ENABLED,
  loginUserMax: env().RATE_LIMIT_LOGIN_USER_MAX,
  loginUserWindowSeconds: env().RATE_LIMIT_LOGIN_USER_WINDOW_SECONDS,
  keyMax: env().RATE_LIMIT_KEY_MAX,
  keyWindowSeconds: env().RATE_LIMIT_KEY_WINDOW_SECONDS,
}));

export const aiConfig = registerAs('ai', () => ({
  // Safe defaults normalised in ONE place: absent/unknown provider → 'real',
  // absent cap → 'on'. The factory reads these clean values, never process.env.
  providerMode: env().AI_PROVIDER ?? 'real',
  capMode: env().AI_CAP ?? 'on',
  capLimit: env().AI_CAP_LIMIT,
  geminiApiKey: env().GEMINI_API_KEY,
  modelId: env().MODEL_ID,
  topP: env().GEMINI_TOP_P,
  topK: env().GEMINI_TOP_K,
  temperature: env().GEMINI_TEMPERATURE,
  logResponses: env().LOG_GEMINI_RESPONSE,
}));

export const channelConfig = registerAs('channel', () => ({
  telegramWebhookSecret: env().TELEGRAM_WEBHOOK_SECRET,
  /* [FEAT-20260905-MULTIEVENT] Resolved to a boolean HERE, once, so no consumer ever
     compares the string. Same normalise-in-one-place rule as `aiConfig` above. */
  multiEventDelivery: env().WEBHOOK_MULTI_EVENT === 'on',
}));

/**
 * [FEAT-20260821-QUOTEREPLY] Chat-console knobs. Its own section on purpose:
 * `channelConfig` is built by hand in TEN specs and harnesses, so widening it ripples.
 * (The count said "two" until 05/09, when adding one field to `channelConfig` found the
 * other eight. A number in a comment is a claim like any other — this one is measured:
 * `grep -rn 'telegramWebhookSecret' z-test`.)
 */
export const chatConfig = registerAs('chat', () => ({
  // 'off' = push only (today). See env.schema.ts + channels/outbound-send-strategy.ts.
  replyReuse: env().CHAT_REPLY_REUSE,
  /* [FEAT-20260918-AUTOTRANS] 'off' = the inbound translate plug is not provided
     at all. See env.schema.ts + translate/auto/. */
  autoTranslate: env().CHAT_AUTO_TRANSLATE,
}));

export const realtimeConfig = registerAs('realtime', () => ({
  wsEnv: env().WS_ENV,
  prodWsChannel: env().PROD_WS_CHANNEL,
  // [FEAT-20260808-HTTPONLY-S1] TTL of the single-use WS connection ticket
  // (`ws_ticket:<token>`), consumed by omnidesk-ws via GETDEL. Ephemeral Redis key.
  wsTicketTtlSec: env().WS_TICKET_TTL_SEC,
}));

export const integrationConfig = registerAs('integration', () => ({
  shopapiBaseUrl: env().SHOPAPI_BASE_URL,
  shopapiSecret: env().SHOPAPI_SECRET,
  v4BaseUrl: env().V4_BASE_URL,
  swiftcheckApiBaseUrl: env().SWIFTCHECK_API_BASE_URL,
  ignoreDocId: env().IGNORE_DOC_ID,
  externalApiBaseUrl: env().EXTERNAL_API_BASE_URL,
  externalApiUsername: env().EXTERNAL_API_USERNAME,
  externalApiPassword: env().EXTERNAL_API_PASSWORD,
}));

export const migrationConfig = registerAs('migration', () => ({
  targetDatabase: env().MIGRATION_TARGET_DB,
}));

export const handoffConfig = registerAs('handoff', () => ({
  workerEnabled: env().HANDOFF_WORKER,
  allowedDatabases: env().HANDOFF_ALLOWED_DB,
}));

/**
 * [FEAT-20260808-ACLSEED] ACL bootstrap seeder config. Defaults for the three
 * seed accounts are normalised in ONE place — the seeder reads these clean
 * values, never process.env — and mirror the legacy defaults exactly.
 */
export const seedConfig = registerAs('seed', () => ({
  aclSeedOnBoot: env().ACL_SEED_ON_BOOT,
  adminUsername: env().INIT_ADMIN_USERNAME ?? 'admin',
  adminPassword: env().INIT_ADMIN_PASSWORD ?? 'admin',
  adminDisplayName: env().INIT_ADMIN_DISPLAY_NAME ?? 'Administrator',
  devUsername: env().INIT_DEV_USERNAME ?? 'dev',
  devPassword: env().INIT_DEV_PASSWORD ?? 'dev',
  devDisplayName: env().INIT_DEV_DISPLAY_NAME ?? 'Developer',
  suUsername: env().INIT_SU_USERNAME ?? 'su',
  suPassword: env().INIT_SU_PASSWORD ?? 'su',
  suDisplayName: env().INIT_SU_DISPLAY_NAME ?? 'Super User',
}));

/**
 * Hook cache TTLs. Two layers, two very different lifetimes — see the comments
 * on the env keys for why L1 is short and L2 is long.
 */
export const hookCacheConfig = registerAs('hookCache', () => ({
  redisTtlSeconds: env().HOOK_CACHE_TTL_SEC,
  l1TtlMs: env().HOOK_L1_TTL_MS,
}));

/**
 * [FEAT-20260808-QCACHE] Scoped query cache — per-page TTL knobs.
 *
 * One TTL (seconds) per read-heavy, non-realtime page. 0/unset ⇒ that page's
 * cache is OFF and the endpoint serves a live DB query (identical to today).
 * `jitterPct` spreads expiry across entries to avoid a synchronised stampede.
 *
 * DB-EFFECT: no Mongo schema/write change; nothing is written to Mongo. The
 * cache stores ephemeral TTL'd keys in REDIS only and causes FEWER Mongo reads.
 */
export const queryCacheConfig = registerAs('queryCache', () => ({
  ttlDashboardSeconds: env().CACHE_TTL_DASHBOARD,
  ttlInsightSeconds: env().CACHE_TTL_INSIGHT,
  ttlWebhookLogSeconds: env().CACHE_TTL_WEBHOOKLOG,
  ttlAuditSeconds: env().CACHE_TTL_AUDIT,
  jitterPct: env().CACHE_TTL_JITTER_PCT,
}));

/**
 * [FEAT-20260905-CUSTPROV] Which customer provider answers. Raw and possibly
 * unset — `CustomerProviderService` is the only thing that interprets it.
 */
export const customerProviderConfig = registerAs('customerProvider', () => ({
  name: env().CUSTOMER_PROVIDER,
}));

/**
 * [FEAT-20260908-CHATTRANS] The translate capability's own knobs.
 *
 * 🔴 A NEW NAMESPACE, NOT A WIDER `aiConfig`. The warning fourteen namespaces
 * above this one is the reason: `channelConfig` is built by hand in TEN specs
 * and harnesses, so widening it ripples — and the count was believed to be two
 * until 05/09, when adding one field found the other eight. `aiConfig` is worse
 * on that axis, not better: it is injected by `webhook.module.ts` (twice),
 * `webhook.service.ts` and every harness that hand-builds one. A brand-new
 * namespace ripples into NONE of them, and nothing that exists today reads it.
 *
 * 🔴 `capLimit` IS THE FALLBACK, RESOLVED HERE AND ONLY HERE. `AI_TRANSLATE_
 * CAP_LIMIT` unset ⇒ `AI_CAP_LIMIT`, i.e. exactly today's ceiling. This is the
 * one place that can see both keys, and resolving it here — the same
 * normalise-in-one-place rule `aiConfig` states for its own defaults — means no
 * consumer ever has to know there are two vars, and none of them can disagree
 * about which wins. Raising translate's ceiling never moves the number the
 * reply and assist-summary decorators read. ยกเพดานแปล ไม่ไปแตะเพดานบอท.
 */
export const aiTranslateConfig = registerAs('aiTranslate', () => ({
  capLimit: env().AI_TRANSLATE_CAP_LIMIT ?? env().AI_CAP_LIMIT,
  previewMax: env().AI_TRANSLATE_PREVIEW_MAX,
  previewWindowSeconds: env().AI_TRANSLATE_PREVIEW_WINDOW_SECONDS,
}));

/**
 * [FEAT-20261016-TOOLMINT] The mint companies' credentials, as validated env — every declared
 * `LOAN_TOOL_*` key and nothing else (the schema already dropped anything undeclared, so the
 * schema stays the one gate). A lookup, not nine named fields: the provider row names its own
 * prefix, so adding a company never touches this file. Only `hooks/tool-mint/` injects it.
 */
export const toolMintConfig = registerAs('toolMint', () => {
  const all = env() as unknown as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('LOAN_TOOL_') && typeof v === 'string') values[k] = v;
  }
  return { values };
});

export const configNamespaces = [
  coreConfig,
  mongoConfig,
  redisConfig,
  authConfig,
  httpConfig,
  cookieConfig,
  rateLimitConfig,
  aiConfig,
  channelConfig,
  chatConfig,
  realtimeConfig,
  integrationConfig,
  migrationConfig,
  handoffConfig,
  hookCacheConfig,
  seedConfig,
  queryCacheConfig,
  customerProviderConfig,
  /* Appended, never inserted — this array is loaded in order by
     `config.module.ts` and adding at the end cannot move anyone else's slot. */
  aiTranslateConfig,
  /* [FEAT-20261016-TOOLMINT] appended — see the note above aiTranslateConfig */
  toolMintConfig,
];
