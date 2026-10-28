/**
 * [FEAT-20260908-CHATTRANS] The one-edge rule for `src/modules/ai-translate/`,
 * enforced instead of documented.
 *
 * WHY THIS FILE HAS TO EXIST. The module's whole value is that it knows nothing
 * about its callers: chat calls it, tickets may call it, a future job may call
 * it, and it must be reachable from all of them without sitting on the wrong
 * side of an arrow in a graph that ALREADY cycles (`chat → webhook` and
 * `webhook → chat` both exist). Nothing in this repo enforces that today —
 * `eslint.config.mjs` has no module→module rule at all, and the only executable
 * statement of the property anywhere is hard-scoped to `src/modules/ai-vendor/`
 * (`ai-vendor-single-door.spec.ts`). Without this file the rule is a sentence in
 * a plan, and the first import someone adds under deadline will compile, pass
 * review and ship.
 *
 * ── THE CONTRACT, stated as the allow-list this file checks ──────────────────
 *   @/modules/ai-vendor   the shared door — the ONE module edge. CALL it, never
 *                         CHANGE it: it is neutral ground shared with the reply,
 *                         summary, qr-vision and rag-engine lanes, so an edit
 *                         inside it reaches all of them in one commit.
 *   @/config/*            config sits BELOW modules; used type-only here
 *   @/common              the same rule every module in this repo follows
 *   node_modules          @nestjs/*, node: builtins. axios lives behind the door
 *   relative              anything resolving back inside this directory
 *
 * Everything else is refused, above all `@/modules/hooks`, `@/infra/crypto`,
 * `@/modules/chat` and `@/modules/tickets`. ประตูต้องไม่รู้จักคนเรียก.
 *
 * ── THREE DESIGN DECISIONS, each one a trap avoided ──────────────────────────
 *
 * 1. 🔴 IT LOOKS INWARD ONLY. There is deliberately NO assertion about who
 *    imports INTO `ai-translate` — that is the mirror of
 *    `menu-isolation-census.spec.ts:91-104,135-149`, and copying that half here
 *    would be a mistake: chat and tickets are MEANT to call this module, so an
 *    outward sweep would put other lanes' import lines under this spec's
 *    judgement, including files nobody has written yet. A guard for one module
 *    must not be able to fail because of another module's code.
 *
 * 2. 🔴 IT RESOLVES PATHS RATHER THAN PATTERN-MATCHING `../`. The obvious model,
 *    `ai-vendor-single-door.spec.ts:198-213`, matches `/from '@\/modules\/[^']+'/`
 *    — which was measured returning NULL for `'../../hooks/foo'`, for double
 *    quotes, for `require()` and for dynamic `import()`. A relative escape is
 *    exactly how this rule would realistically be broken, so every specifier is
 *    resolved on disk and checked for actually landing inside the module.
 *
 * 3. 🔴 IT HAS AN ANTI-VACUITY CHECK, because this repo has shipped a hollow
 *    tripwire before (the comment stripper that ate `//` inside `https://` —
 *    `ai-vendor-single-door.spec.ts:82-93`). If the walk breaks, or the folder
 *    is renamed, every list below goes trivially empty and every case passes
 *    while checking nothing. The last case makes that impossible.
 *
 * MUTATION-PROVED, not assumed: adding `import { X } from '@/modules/hooks'` to
 * a file in this folder turns the first case RED, by file and by specifier. It
 * was run, and it did.
 *
 * revert: delete this file. The module keeps its shape; only the enforcement goes.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const SRC = resolve(__dirname, '../../src');
const MODULE_DIR = join(SRC, 'modules', 'ai-translate');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
};

const rel = (p: string): string => p.slice(SRC.length + 1);

/**
 * 🔴 COMMENTS ARE STRIPPED FIRST, AND THE FIRST RUN OF THIS FILE IS WHY.
 *
 * It went red on `modules/ai-translate/index.ts → @/modules/ai-translate` — a
 * DOC COMMENT reading *"import '@/modules/ai-translate', never a deep file"*.
 * Prose that describes an import is not an import, and a guard that cannot tell
 * the difference punishes people for writing headers. Left unstripped it would
 * also have been a live tripwire on every future comment in this folder.
 *
 * The line-comment rule is deliberately crude, copied from
 * `ai-vendor-single-door.spec.ts:95-101`: `//` is only treated as a comment when
 * it is NOT preceded by `:`, so a `https://` inside a string survives. That
 * repo's stripper once ate exactly that and turned an entire census vacuous
 * while staying green. Erring toward keeping text means this file can raise a
 * FALSE ALARM; it can never fall silent. A guard that fails loudly gets fixed,
 * one that passes quietly does not.
 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');

/**
 * Every import specifier in a file, HOWEVER it is written — `import … from`,
 * bare `import '…'`, `require('…')` and dynamic `import('…')` all match. A rule
 * that only understands one spelling is a rule with three ways around it.
 */
const importsOf = (file: string): string[] => {
  const src = codeOnly(readFileSync(file, 'utf8'));
  return [...src.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)]
    .map((m) => m[1]!)
    .filter((s) => s !== 'use strict');
};

/** The aliased edges this module may have. Nothing else under `@/modules/`. */
const ALLOWED_ALIASES = [
  /^@\/modules\/ai-vendor(\/|$)/,
  /^@\/config(\/|$)/,
  /^@\/common(\/|$)/,
];

describe('[FEAT-20260908-CHATTRANS] ai-translate is a one-edge module', () => {
  const files = walk(MODULE_DIR);

  it('🔴 imports NO module but the door — every other @/modules/* edge is refused', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('@/')) continue;
        if (ALLOWED_ALIASES.some((re) => re.test(spec))) continue;
        offenders.push(`${rel(file)} → ${spec}`);
      }
    }
    /* Named, not counted, so a regression says WHICH file and WHICH import. */
    expect(offenders).toEqual([]);
  });

  it('🔴 no relative import escapes the module directory', () => {
    /* The realistic way this rule breaks. `'../hooks/foo'` carries no `@/`, so
       an alias-only check would wave it through — and `../` alone is not the
       tell either, since `vendors/*.transport.ts` legitimately reaches `../` for
       its own siblings. Only resolving the path answers the question. */
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(MODULE_DIR)) {
          offenders.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 no file here opens its own socket — axios lives behind the door', () => {
    /* The module edge being legal is what makes this necessary: `ai-vendor` is
       importable, so someone could reasonably think reaching past it is too.
       `ai-vendor-single-door.spec.ts` guards the `vendors/` folder; this guards
       the whole module, including files that folder's prefix would miss. */
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (spec === 'axios' || spec.startsWith('axios/')) {
          offenders.push(`${rel(file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the census is not vacuous — it really is reading the module', () => {
    /* Without this, a broken walk or a renamed folder makes all three lists
       above trivially empty and the whole file passes while proving nothing.
       That failure has shipped in this repo before; it is not hypothetical. */
    expect(existsSync(MODULE_DIR)).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(10);
    /* And the import reader really reads: the door edge must be FOUND, not just
       "not violated". If this drops to zero the module stopped calling the door
       — or `importsOf` broke, which is the same silence. */
    const doorEdges = files.flatMap((f) =>
      importsOf(f).filter((s) => s.startsWith('@/modules/ai-vendor')),
    );
    expect(doorEdges.length).toBeGreaterThanOrEqual(3);
  });
});
