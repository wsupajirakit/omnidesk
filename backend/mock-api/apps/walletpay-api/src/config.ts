import { BaseEnv, loadConfig, assertSecrets } from '@zcrm/core';
import { Type, type Static } from 'typebox';

export const WalletpayEnv = Type.Object({
  ...BaseEnv.properties,
  WALLETPAY_PORT: Type.Number({ default: 3302 }),
    /** multipart field the backend sends the slip in (`payment.walletpay_file_field`, default `slip`) */
    WALLETPAY_FILE_FIELD: Type.String({ default: 'slip', pattern: '^[a-zA-Z0-9_-]{1,40}$' }),
    WALLETPAY_MAX_SLIP_BYTES: Type.Number({ default: 5_242_880, minimum: 1024 }),
    /** optional source-IP allowlist (comma separated). Empty = any (local dev). */
    WALLETPAY_ALLOW_IPS: Type.String({ default: '' }),
    /** enables POST /__admin/reset when set (Bearer). Empty = admin routes do not exist. */
    WALLETPAY_ADMIN_TOKEN: Type.String({ default: '' }),
    WALLETPAY_DATA_FILE: Type.String({ default: '' }),
});
export type WalletpayConfig = Static<typeof WalletpayEnv>;

export function walletpayConfig(env: NodeJS.ProcessEnv = process.env): WalletpayConfig {
  const c = loadConfig(WalletpayEnv, env);
  if (c.WALLETPAY_ADMIN_TOKEN) assertSecrets(c.NODE_ENV, { WALLETPAY_ADMIN_TOKEN: c.WALLETPAY_ADMIN_TOKEN });
  return c;
}
