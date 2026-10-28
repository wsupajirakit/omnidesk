/**
 * [FIX-20260905-CUSTPROVWIRING] A service that INJECTS `CustomerProviderService`
 * must live in a module that IMPORTS `CustomerProviderModule`.
 *
 * ## Why this file exists — a bug that every other kind of test missed
 * `TicketsService` gained a `CustomerProviderService` constructor parameter and
 * `TicketsModule` was never told about it. On 05/09 that shipped through:
 *
 *   · `tsc --noEmit`   clean — the parameter's TYPE is perfectly valid.
 *   · 210 unit tests   green — every spec constructs the service DIRECTLY, so
 *                      nothing ever assembles the module graph.
 *   · eslint           silent — nothing is lexically wrong.
 *
 * It failed the only way it could: the application refused to BOOT.
 *
 *   Nest can't resolve dependencies of the TicketsService (…, ?).
 *   Please make sure that the argument CustomerProviderService at index [9]
 *   is available in the TicketsModule module.
 *
 * Found by building `dist` and starting the server — not by reading, and not by
 * a green suite. เทสเขียวไม่ใช่หลักฐาน ต้อง build แล้วรันจริง
 *
 * ## Why a SOURCE scan rather than a compiled `Test.createTestingModule`
 * Compiling the real module needs a Mongo connection, Redis and the config
 * chain, so it belongs in an integration run, not here. This case answers the
 * one question that actually broke — *is the provider reachable from the module
 * that needs it?* — in milliseconds and with no infrastructure, and it covers
 * EVERY module rather than the one that happened to break. The rejected
 * alternative, a compile test for `TicketsModule` alone, would have proven more
 * about one module and nothing about the next one to make this mistake.
 *
 * revert: delete this file. The protection goes with it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** Every `.ts` under `src/`, so a new module cannot escape by being new. */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });

const FILES = walk(SRC);

/**
 * Comments stripped character by character, so a `//` inside a string or a URL
 * does not silently blank the rest of a line.
 *
 * ⚠️ Written out rather than reused from a helper because a guard that depends
 * on the thing it guards is not a guard. The same stripper written naively —
 * filtering on a line PREFIX — produced a false positive twice today, once on a
 * block comment's continuation line.
 */
const stripComments = (input: string): string => {
  let out = '';
  let i = 0;
  let state: 'code' | 'block' | 'line' | '"' | "'" | '`' = 'code';
  while (i < input.length) {
    const c = input[i];
    const next = input[i + 1] ?? '';
    if (state === 'code') {
      if (c === '/' && next === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === '/' && next === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        state = c;
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
      }
      i += 1;
      continue;
    }
    out += c;
    if (c === '\\') {
      out += next;
      i += 2;
      continue;
    }
    if (c === state) state = 'code';
    i += 1;
  }
  return out;
};

/** The module file that owns a service file: the nearest `*.module.ts` beside it. */
const moduleFor = (serviceFile: string): string | null => {
  const dir = serviceFile.slice(0, serviceFile.lastIndexOf('/'));
  const found = readdirSync(dir).filter((f) => f.endsWith('.module.ts'));
  return found.length === 1 ? join(dir, found[0]!) : null;
};

describe('[CUSTPROV/WIRING] injecting the provider requires importing its module', () => {
  const injectors = FILES.filter((f) => {
    if (f.endsWith('.spec.ts') || f.endsWith('.module.ts')) return false;
    const src = stripComments(readFileSync(f, 'utf8'));
    // A CONSTRUCTOR parameter, not a type-only import — that is what Nest resolves.
    return /:\s*CustomerProviderService\b/.test(src);
  });

  it('⭐ at least one service injects it — otherwise this guard guards nothing', () => {
    // A guard whose subject has vanished passes forever while proving nothing.
    expect(injectors.length).toBeGreaterThan(0);
  });

  it.each(
    // The provider's own module is the definition, not a consumer of it.
    injectors.filter((f) => !f.includes('/customer-provider/')),
  )('⭐ %s — its module imports CustomerProviderModule', (file) => {
    const mod = moduleFor(file);
    expect(`${file} has one module file: ${mod !== null}`).toBe(
      `${file} has one module file: true`,
    );
    const src = stripComments(readFileSync(mod!, 'utf8'));
    /* Both halves matter. The `import {}` line alone compiles and boots nothing;
       the name inside `imports:` is what puts the provider in the graph. */
    expect(src).toContain('CustomerProviderModule');
    expect(
      /imports:\s*\[[\s\S]*?CustomerProviderModule[\s\S]*?\]/.test(src),
    ).toBe(true);
  });

  it('⭐ the guard really fails when the import is missing', () => {
    /* Proves the assertion above is not vacuous, without editing a real module.
       A module text with the symbol imported but NOT listed in `imports:` is
       exactly the shape that booted-and-died, and it must be rejected. */
    const looksWired = (src: string) =>
      /imports:\s*\[[\s\S]*?CustomerProviderModule[\s\S]*?\]/.test(
        stripComments(src),
      );
    expect(
      looksWired(
        "import { CustomerProviderModule } from '@/modules/customer-provider';\n" +
          '@Module({ imports: [SystemModule], providers: [X] })\nexport class XModule {}',
      ),
    ).toBe(false);
    expect(
      looksWired(
        '@Module({ imports: [SystemModule, CustomerProviderModule] })\nexport class XModule {}',
      ),
    ).toBe(true);
    // And a mention that lives only inside a comment must not count as wiring.
    expect(
      looksWired(
        '/* imports: [CustomerProviderModule] */\n@Module({ imports: [A] })',
      ),
    ).toBe(false);
  });
});
