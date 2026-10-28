/**
 * Test-only defaults for the variables the env contract requires, so a clean checkout (no
 * .env.local) can boot the Nest testing modules. Values are inert placeholders; anything already
 * set in the environment wins. Never used outside Jest.
 */
const defaults: Record<string, string> = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/omnidesk_test',
  JWT_SECRET: 'test-jwt-secret',
  ENCRYPTION_KEY: 'test-encryption-key',
};
for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) process.env[k] = v;
}
