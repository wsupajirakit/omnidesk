import { BaseEnv, PLACEHOLDER_SECRET, assertSecrets, loadConfig } from '@zcrm/core';
import { Type, type Static } from 'typebox';

export const MemberEnv = Type.Object({
  ...BaseEnv.properties,
  MEMBER_PORT: Type.Number({ default: 3301 }),
  /** first path segment of the data routes (`<prefix>/v1/customer` …). The backend's custom tool sets the same prefix. */
  MEMBER_API_PREFIX: Type.String({ default: 'member-api', pattern: '^[a-z0-9][a-z0-9-]{0,40}$' }),
  /** v1 HMAC secret — the custom tool's `api_key` on the backend */
  MEMBER_HMAC_SECRET: Type.String({ default: PLACEHOLDER_SECRET }),
  MEMBER_HMAC_WINDOW_SEC: Type.Number({ default: 300, minimum: 30, maximum: 900 }),
  /** v3 / legacy login */
  MEMBER_LOGIN_USERNAME: Type.String({ default: 'demo-client' }),
  MEMBER_LOGIN_PASSWORD: Type.String({ default: PLACEHOLDER_SECRET }),
  MEMBER_JWT_SECRET: Type.String({ default: PLACEHOLDER_SECRET }),
  MEMBER_JWT_ACCESS_TTL_SEC: Type.Number({ default: 900, minimum: 60 }),
  MEMBER_JWT_REFRESH_TTL_SEC: Type.Number({ default: 86_400, minimum: 300 }),
  MEMBER_MAX_SLIP_BYTES: Type.Number({ default: 5_242_880, minimum: 1024 }),
  MEMBER_ALLOW_IPS: Type.String({ default: '' }),
  MEMBER_ADMIN_TOKEN: Type.String({ default: '' }),
  MEMBER_DATA_DIR: Type.String({ default: '' }),
});
export type MemberConfig = Static<typeof MemberEnv>;

export function memberConfig(env: NodeJS.ProcessEnv = process.env): MemberConfig {
  const c = loadConfig(MemberEnv, env);
  assertSecrets(c.NODE_ENV, {
    MEMBER_HMAC_SECRET: c.MEMBER_HMAC_SECRET,
    MEMBER_LOGIN_PASSWORD: c.MEMBER_LOGIN_PASSWORD,
    MEMBER_JWT_SECRET: c.MEMBER_JWT_SECRET,
    ...(c.MEMBER_ADMIN_TOKEN ? { MEMBER_ADMIN_TOKEN: c.MEMBER_ADMIN_TOKEN } : {}),
  });
  return c;
}
