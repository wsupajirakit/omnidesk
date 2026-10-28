/**
 * [FEAT-20261014-TOOLSEED] Seed a vendor's custom tool + dynamic tags from a bundle. Any vendor.
 * ============================================================================
 * Replaces `seed-loan-v1-tool.ts` (loan-only, 30/08). The work is the same — turn a
 * configuration proven on a dev clone into rows on another database without anyone re-typing
 * six endpoints by hand — but nothing here knows a vendor: the vendor is a BUNDLE
 * (`custom-tool-seed/bundles/`), selected by `--bundle <id>`. Vendor C = one bundle file.
 *
 * WHAT IT DOES NOT DO (unchanged): it never switches an OA over. Hooks are only READ (to turn
 * `--hook <alias>` into an id). Turning the tool on is a person's decision on the hook form.
 *
 * SAFETY: dry run by default · a write needs a deployment address (never the capture host by
 * accident) · tags are bound with $addToSet · any tag-name collision refuses the whole run ·
 * the password comes from the environment and is encrypted with THIS deployment's key by the
 * real `CryptoService` (a copied ciphertext would not decrypt elsewhere).
 *
 *   node dist/cli/seed-custom-tool.js --bundle loan_v1                       # plan only
 *   SEED_TOOL_USERNAME=… SEED_TOOL_PASSWORD=… \
 *     node dist/cli/seed-custom-tool.js --bundle loan_v1 --base-url https://… --yes
 *   … --hook <alias>          # also bind the bundle's tags to that OA (added, not replaced)
 *   … --allow-capture-host    # only when this DB really should talk to the capture host
 *   env: MONGODB_URI · ENCRYPTION_KEY (write) · SEED_TOOL_BASE_URL (instead of --base-url)
 *
 * revert: restore `src/cli/seed-loan-v1-tool.ts` + the two `docs/loan-v1-*-snapshot.json`
 * from `ckpt-after-loanv1-p2-14102026`, delete this file and `custom-tool-seed/`, drop the
 * `seed:tool` script. Rows it wrote: the tool by name, tags whose `detail` holds the marker.
 */
import mongoose from 'mongoose';

import type { ConfigType } from '@nestjs/config';

import type { authConfig } from '../config/app.config';
import { CryptoService } from '../infra/crypto/crypto.service';

import { SEED_BUNDLES } from './custom-tool-seed/bundles';
import { resolveSeedBaseUrl } from './custom-tool-seed/seed-plan';
import { runSeed } from './custom-tool-seed/seed-run';

const say = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string, code = 1): never => {
  process.stderr.write(`${line}\n`);
  process.exit(code);
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const has = (f: string): boolean => argv.includes(f);
  const valueOf = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const apply = has('--yes');

  const bundle = SEED_BUNDLES.get(valueOf('--bundle') ?? '');
  if (!bundle) {
    return fail(
      `❌ --bundle <id> required · available: ${[...SEED_BUNDLES.keys()].join(', ')}`,
    );
  }
  const base = resolveSeedBaseUrl(bundle, {
    requested: valueOf('--base-url') ?? process.env.SEED_TOOL_BASE_URL,
    apply,
    allowCaptureHost: has('--allow-capture-host'),
  });
  if (!base.ok) return fail(`❌ ${base.reason}`);

  const uri = process.env.MONGODB_URI;
  if (!uri) return fail('❌ MONGODB_URI is not set');
  const password = process.env.SEED_TOOL_PASSWORD;
  const encKey = process.env.ENCRYPTION_KEY;
  if (apply && (!password || !encKey)) {
    return fail(
      '❌ a write needs SEED_TOOL_PASSWORD and ENCRYPTION_KEY (the bundle holds no secret)',
    );
  }

  say(`📦 ${bundle.id}: ${bundle.description}`);
  if (base.isCaptureHost) say(`   ⚠️ base_url is the CAPTURE host ${base.url}`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) return fail('❌ no Mongo connection');
  const crypto = new CryptoService({ encryptionKey: encKey } as ConfigType<
    typeof authConfig
  >);

  const result = await runSeed(
    {
      tools: db.collection('custom_tools'),
      tags: db.collection('dynamic_tags'),
      hooks: db.collection('hooks'),
    },
    {
      bundle,
      baseUrl: base.url,
      apply,
      hookAlias: valueOf('--hook'),
      username: process.env.SEED_TOOL_USERNAME ?? '',
      encryptPassword: () => crypto.encrypt(password) ?? '',
      now: new Date(),
    },
  );
  result.lines.forEach(say);
  await mongoose.disconnect();
  process.exit(result.exitCode);
}

main().catch((e: Error) => fail(`❌ ${e.message}`));
