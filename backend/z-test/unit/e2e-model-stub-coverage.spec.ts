/* [FIX-20260815-E2EMODELSTUB] the e2e model stub list must cover every model
 * ===========================================================================
 * `webhook-pipeline.e2e-spec.ts` boots the real WebhookModule with no database.
 * That works only while EVERY model Nest can reach is overridden with a stub:
 * Nest resolves the whole graph at compile time, so one un-stubbed model makes
 * it demand a real `DatabaseConnection` and the suite dies at boot — all 37
 * cases fail together, before a single assertion runs.
 *
 * That is exactly how it broke. `SlipVerification` and the six `Handoff*`
 * models were registered by modules that reach the graph through
 * WebhookModule's imports, and nobody updated the stub list. The failure did
 * not point at the new model either: it named whichever one Nest happened to
 * resolve first, so fixing it by hand meant re-running the suite once per
 * missing name, never knowing how many were left.
 *
 * This spec closes it by comparing the list against the SOURCE OF TRUTH — every
 * `{ name: X.name, schema: … }` registration under `src/modules` — so adding a
 * model to any module fails here, in one second, with the missing names printed,
 * instead of failing the e2e suite at boot with a misleading one.
 *
 * เพิ่ม model ใหม่ที่โมดูลไหนก็ตาม ต้องมาเติมลิสต์ใน e2e ด้วย ไม่งั้น e2e ตายทั้ง suite
 *
 * revert: delete this file. The e2e suite then breaks again the next time a
 *         model is registered, with the same misleading boot error.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MODULES_DIR = join(__dirname, '..', '..', 'src', 'modules');
const E2E_SPEC = join(__dirname, '..', 'e2e', 'webhook-pipeline.e2e-spec.ts');

/** Every model registered through `MongooseModule.forFeature` in any module. */
const registeredModels = (): string[] => {
  const found = new Set<string>();
  for (const dir of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const moduleFile = join(MODULES_DIR, dir.name, `${dir.name}.module.ts`);
    let source: string;
    try {
      source = readFileSync(moduleFile, 'utf8');
    } catch {
      continue; // a module directory without the conventional file name
    }
    for (const m of source.matchAll(/\{\s*name:\s*(\w+)\.name,\s*schema/g)) {
      found.add(m[1]!);
    }
  }
  return [...found].sort();
};

/** Every model the e2e spec stubs — the explicit fakes and the empty ones. */
const stubbedModels = (): string[] => {
  const source = readFileSync(E2E_SPEC, 'utf8');

  const explicit = [...source.matchAll(/getModelToken\('(\w+)'\)/g)].map(
    (m) => m[1]!,
  );

  const listBlock = /const EMPTY_MODEL_NAMES = \[([\s\S]*?)\];/.exec(source);
  const empty = listBlock
    ? [...listBlock[1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!)
    : [];

  return [...new Set([...explicit, ...empty])].sort();
};

describe('[E2EMODELSTUB] the e2e suite stubs every registered model', () => {
  /* The guard itself must not pass vacuously: a regex that silently matches
     nothing would make the coverage check trivially true. */
  it('reads a non-trivial number of models from the modules', () => {
    expect(registeredModels().length).toBeGreaterThan(30);
  });

  it('reads the stub list out of the e2e spec', () => {
    expect(stubbedModels().length).toBeGreaterThan(30);
  });

  /* The real assertion. When it fails, the message names exactly which models
     to add — the information the boot error withholds. */
  it('leaves no registered model without a stub', () => {
    const missing = registeredModels().filter(
      (name) => !stubbedModels().includes(name),
    );

    expect({ missing }).toEqual({ missing: [] });
  });
});
