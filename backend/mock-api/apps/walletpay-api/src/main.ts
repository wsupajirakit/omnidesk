import { walletpayConfig } from './config.js';
import { buildWalletpayApp } from './app.js';

const cfg = walletpayConfig();
const { app } = await buildWalletpayApp(cfg);
await app.listen({ host: cfg.HOST, port: cfg.WALLETPAY_PORT });

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void app.close().then(() => process.exit(0)));
