import { memberConfig } from './config.js';
import { buildMemberApp } from './app.js';

const cfg = memberConfig();
const { app } = await buildMemberApp(cfg);
if (cfg.MEMBER_HMAC_SECRET.startsWith('change-me')) app.log.warn('member-api is running with the placeholder secrets (development only)');
await app.listen({ host: cfg.HOST, port: cfg.MEMBER_PORT });

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void app.close().then(() => process.exit(0)));
