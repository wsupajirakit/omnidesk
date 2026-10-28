/**
 * [FEAT-20260905-CUSTPROV] The resolver, and the rule that there is only one.
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` PART 6 §35
 *
 * ## The case that matters most is the boring one
 * `CUSTOMER_PROVIDER` unset ⇒ `shopapi_v1` ⇒ nothing on screen changes. That is not
 * a smoke test, it is the owner's acceptance condition: staging keeps working
 * with NOTHING set, and a default that has to be written into a config file is
 * not a default. Every other case here exists to stop that one from drifting.
 *
 * ## What is deliberately NOT asserted
 * No test pins the number of entries — a spec that fails when a provider is added
 * would make adding one a two-file change, which is the exact cost this design
 * removes. The rules are asserted; the inventory is not.
 */
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigModule } from '@/config/config.module';
import {
  buildCustomerProviderRegistry,
  CUSTOMER_PROVIDER_ENTRIES,
  CustomerProviderModule,
  CustomerProviderService,
  DEFAULT_CUSTOMER_PROVIDER,
  type CustomerProvider,
} from '@/modules/customer-provider';

const make = (name?: string): CustomerProviderService =>
  new CustomerProviderService({ name });

describe('[CUSTPROV] the default is the status quo, and needs no configuration', () => {
  it('⭐ unset ⇒ shopapi_v1', () => {
    expect(make(undefined).activeName()).toBe('shopapi_v1');
    expect(make(undefined).resolve()).toBe(DEFAULT_CUSTOMER_PROVIDER);
  });

  it('empty and whitespace are the same as unset, not an unknown value', () => {
    // A deploy template that writes `CUSTOMER_PROVIDER=` must behave exactly like
    // one that omits the line, or "unset" stops being one path.
    expect(make('').activeName()).toBe('shopapi_v1');
    expect(make('   ').activeName()).toBe('shopapi_v1');
  });

  /**
   * ⭐ Added after a mutation survived. Deleting the `if (!requested)` branch
   * changed NOTHING that was asserted: an empty value fell through to the
   * registry, missed, and landed on the default anyway — same return value, but
   * now with a warning on every boot of every environment that never set the
   * variable. The value was tested; the SILENCE was not.
   * unset ต้องเงียบ · ค่าผิดต้องเตือน — ผลลัพธ์เท่ากันไม่พอ
   */
  it('⭐ unset is SILENT — it is the normal path, not a misconfiguration', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      make(undefined);
      make('');
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('⭐ an unknown value DOES warn, and names both values', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      make('shopapi_v9_nope');
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]?.[0] ?? '');
      // what was asked for AND what actually answered — a log that names only
      // one of them cannot be reconciled with the screen.
      expect(msg).toContain('shopapi_v9_nope');
      expect(msg).toContain('shopapi_v1');
    } finally {
      warn.mockRestore();
    }
  });

  it('⭐ shopapi_v1 declares TODAY behaviour, not a preference', () => {
    // Each of these is a measurement of the live system. Changing one changes the
    // product, so each is pinned with the file it was read from.
    const p = DEFAULT_CUSTOMER_PROVIDER;
    // member-tier-key.util.ts:38-48 — order is load-bearing
    expect(p.tierPaths).toEqual(['data.profile.tier', 'profile.tier', 'tier']);
    // both surfaces show the tier today
    expect(p.showTierBadge).toBe(true);
    expect(p.showTierFilter).toBe(true);
  });
});

describe('[CUSTPROV] an unknown value falls back — it never throws', () => {
  it('⭐ a typo renders the default instead of taking the process down', () => {
    const svc = make('shopapi_v2_typo');
    expect(svc.activeName()).toBe('shopapi_v1');
  });

  it('the stamped name is what ANSWERED, not what was asked for', () => {
    // If these could differ, the log and the screen could disagree about which
    // provider ran — and the screen is the one people report.
    expect(make('nope').activeName()).toBe(make('nope').resolve().name);
  });
});

describe('[CUSTPROV] switching is real, not decoration', () => {
  const fake: CustomerProvider = {
    name: 'zzz_test',
    description: 'test-only entry',
    tierPaths: ['somewhere.else'],
    showTierBadge: false,
    showTierFilter: false,
    /* A provider that maps NOTHING is still a valid provider — the port requires
       the method, not a particular answer. Kept trivial so this suite stays about
       resolution; the mapping itself is proven in
       `customer-provider-fields.spec.ts` against the dashboard's own vectors. */
    paths: {
      rootPaths: [''],
      sectionPaths: { profile: ['profile'] },
      fieldPaths: {},
    },
    deriveFields: () => ({}) as never,
    buildView: () => ({ sections: [] }),
  };

  it('⭐ a second entry resolves to itself, not to the default', () => {
    // Drives the registry with a modified list, which is why
    // `buildCustomerProviderRegistry` takes one.
    const registry = buildCustomerProviderRegistry([
      ...CUSTOMER_PROVIDER_ENTRIES,
      fake,
    ]);
    expect(registry.get('zzz_test')).toBe(fake);
    expect(registry.get('shopapi_v1')).toBe(DEFAULT_CUSTOMER_PROVIDER);
    // and adding it did not disturb the default
    expect(registry.get('shopapi_v1')?.showTierBadge).toBe(true);
  });

  it('the registry keys off provider.name, never a string typed beside it', () => {
    // Two spellings of one fact can drift; one cannot. Same rule as the slip
    // registry, and this asserts it structurally rather than by reading a map
    // literal that no longer exists.
    for (const entry of CUSTOMER_PROVIDER_ENTRIES) {
      expect(buildCustomerProviderRegistry().get(entry.name)).toBe(entry);
    }
  });

  it('every entry has a usable name and a real description', () => {
    for (const entry of CUSTOMER_PROVIDER_ENTRIES) {
      expect(entry.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(entry.description.length).toBeGreaterThan(20);
      /* [FEAT-20260907-LOANV1PROVIDER] Amended: `tierPaths: []` is a VALID
         declaration for a shape with no tier concept (loan_v1 — the reader
         falls through to the `member.tier` column and the projection collapses
         to `{tier:1}`, member-tier-key.util.ts). But an empty chain is honest
         ONLY when the entry also declares both tier controls OFF — an empty
         list with a visible badge/filter would draw controls over a value the
         provider says it cannot read. The old assertion (`length > 0` for
         every entry) predates the second provider and was proven red against
         loan_v1 before this amendment. */
      const tierless = entry.tierPaths.length === 0;
      if (tierless) {
        expect(entry.showTierBadge).toBe(false);
        expect(entry.showTierFilter).toBe(false);
      } else {
        expect(entry.tierPaths.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The guard. Everything above proves the resolver is right; this proves nothing
 * ELSE is doing the same job somewhere quieter.
 *
 * On 05/09 the environment-namespace convention existed in five places, was
 * written down three times, and was still forgotten in the sixth — and the guard
 * that caught it found a defect in a merge from three hours earlier on its first
 * run. This is that guard, for this rule.
 */
describe('[CUSTPROV] exactly one thing reads the environment', () => {
  const SRC = join(__dirname, '../../src');
  const OWNER = join('modules', 'customer-provider');

  /** Files allowed to mention the variable, each for a stated reason. */
  const ALLOWED: Record<string, string> = {
    [join('config', 'env.schema.ts')]:
      'declares the variable for zod. It states no default and no enum — both of ' +
      'those live in the registry, which is the point of the rule.',
    [join('config', 'app.config.ts')]:
      'exposes the raw value as a typed slice. It does not interpret it; ' +
      'CustomerProviderService is the only thing that does.',
  };

  /**
   * Source with COMMENT LINES dropped.
   *
   * The first version of this guard read the raw text and immediately failed on
   * `env.schema.ts` — whose comment explains why it does NOT write
   * `.default('shopapi_v1')`. A rule that fires on the sentence describing the rule
   * is a rule nobody keeps. Comment LINES are filtered rather than `/* … *\/`
   * blocks stripped, for the reason `external-breaker-tenant-key.spec.ts:168-176`
   * measured: a non-greedy block strip pairs an opening marker with a later
   * closing one and swallows the code between them.
   */
  /**
   * Comments removed by RANGE, not by line prefix.
   *
   * ⚠️ The line-prefix version missed a real case on 05/09: a block comment whose
   * CONTINUATION lines start with plain text —
   *
   *     \/* [PART 4] … so an unset `CUSTOMER_PROVIDER` stamps a response …
   *
   * — kept the mention, and a file that merely explains the flag was reported as
   * a file that reads it. Prefix filtering can only ever see the first line of a
   * block. It walks character by character rather than using a regex so a `//`
   * inside a string literal (a URL) does not swallow the rest of the line.
   * ตัวกรองคอมเมนต์ต้องตัดเป็นช่วง ไม่ใช่ดูหัวบรรทัด
   */
  const stripComments = (src: string): string => {
    let out = '';
    let i = 0;
    let mode: 'code' | 'line' | 'block' | 'str' = 'code';
    let quote = '';
    while (i < src.length) {
      const two = src.slice(i, i + 2);
      if (mode === 'code') {
        if (two === '//') {
          mode = 'line';
          i += 2;
          continue;
        }
        if (two === '/*') {
          mode = 'block';
          i += 2;
          continue;
        }
        if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
          mode = 'str';
          quote = src[i]!;
        }
        out += src[i];
      } else if (mode === 'line') {
        if (src[i] === '\n') {
          mode = 'code';
          out += '\n';
        }
      } else if (mode === 'block') {
        if (two === '*/') {
          mode = 'code';
          i += 2;
          continue;
        }
        if (src[i] === '\n') out += '\n';
      } else {
        out += src[i];
        if (src[i] === '\\') {
          i += 2;
          out += src[i - 1] ?? '';
          continue;
        }
        if (src[i] === quote) mode = 'code';
      }
      i += 1;
    }
    return out;
  };

  const codeOf = (rel: string): string =>
    stripComments(readFileSync(join(SRC, rel), 'utf8'));

  const tsFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory()
        ? tsFiles(full)
        : full.endsWith('.ts')
          ? [full]
          : [];
    });

  /**
   * The env READ, not the substring.
   *
   * ⚠️ The first version searched for `CUSTOMER_PROVIDER` as plain text and
   * fired on `modules/tickets/member-tier-key.util.ts` the moment that file
   * imported `DEFAULT_CUSTOMER_PROVIDER` — the identifier CONTAINS the variable
   * name. That is a consumer of the module's public API, which is the thing this
   * guard exists to encourage, reported as the thing it exists to forbid.
   * `\b` alone does not help: the boundary sits between `_` and `C`, and `_` is
   * a word character, so `DEFAULT_CUSTOMER_PROVIDER` still matched. The guard now
   * requires a preceding character that is NOT part of an identifier.
   * ห้ามจับด้วยสตริงเปล่า — ชื่อตัวแปรอื่นมีคำนี้อยู่ข้างใน
   */
  const READS_ENV = /(^|[^A-Za-z0-9_$])CUSTOMER_PROVIDER\b/;

  it('⭐ no file outside the module reads CUSTOMER_PROVIDER', () => {
    const offenders = tsFiles(SRC)
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => !rel.startsWith(OWNER))
      .filter((rel) => !(rel in ALLOWED))
      .filter((rel) => READS_ENV.test(codeOf(rel)));

    expect(offenders).toEqual([]);
  });

  it('⭐ the comment stripper removes a block comment ENTIRELY, not just its head', () => {
    /* The exact shape that slipped through: the mention is on a continuation
       line, which no prefix filter can see. */
    const src = [
      'const a = 1;',
      '/* [PART 4] resolved once per request, so an unset',
      '   CUSTOMER_PROVIDER stamps a response identical to today. */',
      'const b = 2;',
    ].join('\n');
    expect(stripComments(src)).not.toContain('CUSTOMER_PROVIDER');
    expect(stripComments(src)).toContain('const b = 2;');
  });

  it('⭐ …while a `//` inside a string literal does not swallow the line', () => {
    // A regex-based stripper eats the rest of this line and the read vanishes.
    const src =
      "const u = 'https://x'; const v = process.env.CUSTOMER_PROVIDER;";
    expect(stripComments(src)).toContain('CUSTOMER_PROVIDER');
  });

  it('⭐ the guard still catches a REAL reader, and still ignores the API name', () => {
    // Both directions, so narrowing the pattern cannot have blinded it.
    expect(READS_ENV.test('process.env.CUSTOMER_PROVIDER')).toBe(true);
    expect(READS_ENV.test("config.get('CUSTOMER_PROVIDER')")).toBe(true);
    expect(READS_ENV.test('import { DEFAULT_CUSTOMER_PROVIDER } from x')).toBe(
      false,
    );
  });

  it('every allow-list entry is real and still used', () => {
    // A stale exemption silently widens itself over whatever matches it next.
    for (const [rel, reason] of Object.entries(ALLOWED)) {
      expect(reason.length).toBeGreaterThan(60);
      expect(codeOf(rel)).toContain('CUSTOMER_PROVIDER');
    }
  });

  it('the default is named once, not typed as a string anywhere else', () => {
    // `DEFAULT_CUSTOMER_PROVIDER` is the only definition of "the default". A
    // literal 'shopapi_v1' outside the provider folder would be a second one.
    const offenders = tsFiles(SRC)
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => !rel.startsWith(OWNER))
      .filter((rel) => codeOf(rel).includes("'shopapi_v1'"));

    expect(offenders).toEqual([]);
  });
});

/**
 * The module is registered and resolvable through Nest, not merely compilable.
 *
 * `nest build` proves the imports resolve. It says nothing about whether the
 * provider is actually in a module's `providers`, whether the config slice was
 * loaded, or whether a consumer could inject it — three things that fail at boot
 * and not at build. tsc ผ่านไม่ได้แปลว่าต่อสายถูก
 */
describe('[CUSTPROV] the module wires up through Nest DI', () => {
  it('⭐ resolves from a real testing module with the real ConfigModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, CustomerProviderModule],
    }).compile();

    const svc = moduleRef.get(CustomerProviderService);
    // No CUSTOMER_PROVIDER in this environment ⇒ the default, silently.
    expect(svc.activeName()).toBe('shopapi_v1');
    await moduleRef.close();
  });
});
