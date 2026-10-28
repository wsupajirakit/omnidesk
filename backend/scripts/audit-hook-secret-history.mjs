/**
 * Read the audit trail of a hook's secret fields and show what each value WAS.
 *
 * Why this can answer "what was the old secret": `updateHook` writes one audit
 * row per save with `changed_fields[].from` / `.to` copied straight off the
 * stored document — no redaction — so the previous value is the SAME
 * `enc:`-prefixed ciphertext that was in `hooks`. Decrypting it here uses the
 * exact scheme `CryptoService` uses (sha256(ENCRYPTION_KEY) → AES-256-GCM,
 * `enc:` + base64url iv.data.tag), with ENCRYPTION_KEY_OLD as a fallback key
 * exactly like the service does.
 *
 * ⚠️ READ-ONLY. Opens the DB, prints, closes. It never writes, and it never
 * decrypts anything unless you pass --reveal, so an accidental run cannot leak
 * a live key into a terminal log.
 *
 * Usage (run where MONGODB_URI + ENCRYPTION_KEY point at the DB you mean):
 *   node scripts/audit-hook-secret-history.mjs --alias=demo-shop
 *   node scripts/audit-hook-secret-history.mjs --alias=demo-shop --reveal
 *   node scripts/audit-hook-secret-history.mjs --alias=demo-shop --field=access_token
 *   node scripts/audit-hook-secret-history.mjs --hook-id=a0d000000000000000000005 --limit=50
 *
 * Without --reveal every value is shown as `len=N sha256=xxxxxxxx` — enough to
 * tell "did it change / does it match what LINE has" by comparing fingerprints,
 * without putting the secret on screen.
 *
 * revert: delete this file. Nothing imports it.
 */
import { createDecipheriv, createHash } from 'node:crypto';
// mongoose, not the raw `mongodb` driver: it is this repo's direct dependency
// (the driver is only a transitive one), so this runs anywhere the app runs.
import mongoose from 'mongoose';

const PREFIX = 'enc:';
const DEFAULT_FIELDS = [
  'channel_secret',
  'line_secret',
  'access_token',
  'line_key',
  'custom_ai_key',
  'slip_verify_key',
  'telegram_key',
  'external_password',
  'customer_link_password',
  'api_key',
];

const arg = (name) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] ||
  '';
const has = (name) => process.argv.includes(`--${name}`);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set — point it at the database you mean.');
  process.exit(1);
}

const alias = arg('alias');
const hookIdArg = arg('hook-id');
if (!alias && !hookIdArg) {
  console.error('give --alias=<oa alias> or --hook-id=<ObjectId>');
  process.exit(1);
}

const reveal = has('reveal');
const limit = Number(arg('limit') || 30);
const onlyField = arg('field');
const fields = onlyField ? [onlyField] : DEFAULT_FIELDS;

/** sha256 of the passphrase — the same derivation CryptoService uses. */
const keys = [process.env.ENCRYPTION_KEY, process.env.ENCRYPTION_KEY_OLD]
  .filter((k) => typeof k === 'string' && k.length > 0)
  .map((k) => createHash('sha256').update(k).digest());

function decrypt(text) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return text;
  const [p0, p1, p2] = text.slice(PREFIX.length).split('.');
  if (!p0 || !p1 || !p2) return text;
  const iv = Buffer.from(p0, 'base64url');
  const data = Buffer.from(p1, 'base64url');
  const tag = Buffer.from(p2, 'base64url');
  for (const key of keys) {
    try {
      const d = createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(data), d.final()]).toString('utf8');
    } catch {
      /* try the next key — same fallback order as the service */
    }
  }
  return null; // undecryptable with the keys this process has
}

/** What to print for a value: the plaintext only when --reveal was asked for. */
function show(value) {
  if (value === undefined) return '(absent)';
  if (value === null) return 'null';
  if (value === '') return '(EMPTY STRING)';
  if (typeof value !== 'string') return JSON.stringify(value);

  const plain = value.startsWith(PREFIX) ? decrypt(value) : value;
  if (plain === null) {
    return `UNDECRYPTABLE (ciphertext len=${value.length}) — wrong ENCRYPTION_KEY?`;
  }
  if (reveal) return `"${plain}"`;
  const fp = createHash('sha256').update(plain).digest('hex').slice(0, 8);
  const stored = value.startsWith(PREFIX) ? 'encrypted' : 'PLAINTEXT-AT-REST';
  return `len=${plain.length} sha256=${fp} (${stored})`;
}

await mongoose.connect(uri);
try {
  const db = mongoose.connection.db;
  const { ObjectId } = mongoose.Types;

  const hook = await db
    .collection('hooks')
    .findOne(
      alias ? { alias } : { _id: new ObjectId(hookIdArg) },
      { projection: { alias: 1, display_name: 1 } },
    );
  if (!hook) {
    console.error(`hook not found (${alias || hookIdArg})`);
    process.exit(1);
  }

  console.log(`hook ${hook._id} · alias=${hook.alias}`);
  console.log(`fields: ${fields.join(', ')}`);
  console.log(reveal ? 'MODE: --reveal (plaintext ON SCREEN)' : 'MODE: fingerprints only (pass --reveal for plaintext)');
  console.log('');

  // The current value first — so "old vs now" is readable in one screen.
  const current = await db.collection('hooks').findOne({ _id: hook._id });
  console.log('── CURRENT (hooks collection) ──');
  for (const f of fields) {
    if (current[f] !== undefined) console.log(`  ${f.padEnd(24)} ${show(current[f])}`);
  }
  console.log('');

  const rows = await db
    .collection('hook_audit_logs')
    .find({ hook_id: hook._id, parent: 'hook' })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();

  console.log(`── AUDIT (${rows.length} newest rows, newest first) ──`);
  let printed = 0;
  for (const row of rows) {
    const touched = (row.changed_fields || []).filter((c) =>
      fields.includes(c.field),
    );
    // A save that submitted the field but did not change it still writes a row
    // (see the comment above `changedFields` in hooks.service) — flag those so
    // "someone saved the form" and "the value moved" stay distinguishable.
    const moved = touched.filter((c) => String(c.from) !== String(c.to));
    if (touched.length === 0) continue;
    printed++;

    const when = row.created_at ? new Date(row.created_at).toISOString() : '?';
    const who = row.actor
      ? `${row.actor.username || '?'}${row.actor.display_name ? ` (${row.actor.display_name})` : ''}`
      : '(no actor)';
    const ip = row.request_meta?.ip ? ` ip=${row.request_meta.ip}` : '';
    console.log(
      `\n[${when}] ${row.action} by ${who}${ip}` +
        (moved.length === 0 ? '   ← submitted but VALUE UNCHANGED' : '   ← VALUE CHANGED'),
    );
    for (const c of touched) {
      const changed = String(c.from) !== String(c.to);
      console.log(`  ${c.field}${changed ? ' *' : ''}`);
      console.log(`      from: ${show(c.from)}`);
      console.log(`      to  : ${show(c.to)}`);
    }
  }
  if (printed === 0) {
    console.log('  (no audit row touched these fields — the value was never');
    console.log('   submitted through PUT /hook/:id, or the rows aged out)');
  }
} finally {
  await mongoose.disconnect();
}
