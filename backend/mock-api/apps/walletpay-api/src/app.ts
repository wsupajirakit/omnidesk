import multipart from '@fastify/multipart';
import { adminRoutes, createServer, ipAllowlist, type JsonStore } from '@zcrm/core';

import type { WalletpayConfig } from './config.js';
import { loadPayins, type PayinSeed } from './data.js';
import { payinRoutes } from './routes/payin.js';

export async function buildWalletpayApp(cfg: WalletpayConfig, opts: { logger?: boolean; store?: JsonStore<PayinSeed> } = {}) {
  const store = opts.store ?? loadPayins(cfg.WALLETPAY_DATA_FILE || undefined);
  const app = await createServer({
    name: 'walletpay-api',
    logLevel: cfg.LOG_LEVEL,
    bodyLimit: cfg.BODY_LIMIT_BYTES,
    rateLimit: { max: cfg.RATE_LIMIT_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS },
    ...(opts.logger === undefined ? {} : { logger: opts.logger }),
  });
  ipAllowlist(app, cfg.WALLETPAY_ALLOW_IPS);
  await app.register(multipart, {
    limits: { fileSize: cfg.WALLETPAY_MAX_SLIP_BYTES, files: 1, fields: 20, fieldSize: 4096, parts: 25, headerPairs: 200 },
    throwFileSizeLimit: true,
  });
  payinRoutes(app, cfg, store);
  adminRoutes(app, cfg.WALLETPAY_ADMIN_TOKEN, () => {
    store.reset();
  });
  return { app, store };
}
