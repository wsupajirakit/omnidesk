/**
 * [FLOWTEST-20261014-LOANV1FIXTURE] The loan_v1 fixture is checked against the code that reads it.
 * ============================================================================
 * `z-test/fixtures/loan-v1-endpoints.ts` is GENERATED from real upstream answers
 * (`z-test/tmp/extract-loan-v1-responses.ts`). This file proves those answers still satisfy
 * every declaration that depends on them — so a fixture that drifts, or a declaration that
 * drifts, goes red by name instead of leaving the suite testing a shape that no longer exists
 * (line-flow-test §2).
 *
 * Everything here runs the SHIPPED code, never a copy of its logic:
 *   · `CustomToolService.getCombinedData` + `_request` with the REAL tool snapshot, so the
 *     tool's own `result_rules` decide success/failure — only axios is replaced;
 *   · `pickApiSource` + `getNestedResilient`, the pair every dynamic tag resolves through;
 *   · `CustomToolService.extractProfile`, which turns the tool's `profile_map` into the
 *     name / phone / contract code the webhook carries;
 *   · the loan_v1 provider's own path table.
 *
 * R10: axios is mocked; nothing leaves the process.
 */
import { getNestedResilient, pickApiSource } from '@/modules/ai';
import { buildCustomerProviderRegistry } from '@/modules/customer-provider';
import type { CustomToolService } from '@/modules/external';

/* the bundle lives with the CLI that ships it (src/cli is not a module barrel) */
import { LOAN_V1_SEED_BUNDLE } from '../../src/cli/custom-tool-seed/bundles/loan-v1.bundle';
import {
  LOAN_FIXTURE,
  LOAN_TOOL,
  answerWith,
  makeLoanToolService,
} from '../lib/loan-v1-upstream';

jest.mock('axios');

interface SnapshotTag {
  tag: string;
  sub_type: string;
  value: string;
}

const TOOL = LOAN_TOOL;
const FIXTURE = LOAN_FIXTURE;
/* [FEAT-20261014-TOOLSEED] the tags exactly as the seed CLI writes them */
const TAGS = LOAN_V1_SEED_BUNDLE.tags as SnapshotTag[];
const LOAN_V1_PATHS = buildCustomerProviderRegistry().get('loan_v1')!.paths;

/* The prefetch's own notion of "fetched as data" — auth/login endpoints never are. */
const DATA_KEYS = TOOL.endpoints
  .filter((e) => e.purpose !== 'auth' && e.purpose !== 'write' && !e.is_login)
  .map((e) => e.key);

const makeService = makeLoanToolService;

const HOOK = { _id: 'h1', alias: 'loan-oa' } as never;
type Blocks = Record<string, { success?: boolean } | undefined>;
const UID = 'U00000000000000000000000000000000';

describe('[LOANV1FIXTURE] provenance — the fixture covers exactly the tool', () => {
  it('every data endpoint of the tool snapshot has a fixture entry, and nothing extra', () => {
    expect(Object.keys(FIXTURE).sort()).toEqual([...DATA_KEYS].sort());
  });

  it.each(DATA_KEYS)(
    '%s was sampled from real rows (success AND failure)',
    (key) => {
      const f = FIXTURE[key]!;
      expect(f.source.success).toBeGreaterThan(0);
      expect(f.source.failure).toBeGreaterThan(0);
      expect(f.failures.length).toBeGreaterThan(0);
    },
  );
});

describe('[LOANV1FIXTURE] the tool’s own result_rules judge the real answers', () => {
  let svc: CustomToolService;
  beforeEach(async () => {
    jest.clearAllMocks();
    svc = await makeService();
  });

  it('every real SUCCESS answer is read as success', async () => {
    answerWith((f) => f.success);
    const combined = (await svc.getCombinedData(UID, HOOK)) as Blocks;
    for (const key of DATA_KEYS) {
      expect({ key, success: combined[key]?.success }).toEqual({
        key,
        success: true,
      });
    }
  });

  /* Every distinct failure shape the partner really produced, one run per index. */
  /* `?.` so a MISSING endpoint fails the provenance case by name, not the whole file at load */
  const maxFailures = Math.max(
    ...DATA_KEYS.map((k) => FIXTURE[k]?.failures.length ?? 0),
  );
  it.each([...Array(maxFailures).keys()])(
    'real FAILURE shape #%i is read as failure on every endpoint that produced it',
    async (i) => {
      answerWith((f) => f.failures[i] ?? f.failures[0]!);
      const combined = (await svc.getCombinedData(UID, HOOK)) as Blocks;
      for (const key of DATA_KEYS) {
        expect({ key, success: combined[key]?.success }).toEqual({
          key,
          success: false,
        });
      }
    },
  );
});

describe('[LOANV1FIXTURE] every seeded dynamic tag resolves on the real answers', () => {
  let combined: Record<string, unknown>;
  beforeAll(async () => {
    const svc = await makeService();
    answerWith((f) => f.success);
    combined = await svc.getCombinedData(UID, HOOK);
  });

  it.each(TAGS.map((t) => [t.tag, t.sub_type, t.value] as const))(
    '%s (%s → %s) resolves to a real value',
    (tag, sub_type, value) => {
      const source = pickApiSource(combined, { tag, value, sub_type });
      const v = getNestedResilient(source, value);
      expect({
        tag,
        sub_type,
        value,
        resolved: v !== undefined && v !== null,
      }).toEqual({
        tag,
        sub_type,
        value,
        resolved: true,
      });
    },
  );
});

describe('[LOANV1FIXTURE] the profile endpoint’s profile_map yields the customer + contract', () => {
  it('extractProfile answers name, phone and the CONTRACT number from the real profile', async () => {
    const svc = await makeService();
    answerWith((f) => f.success);
    const combined = await svc.getCombinedData(UID, HOOK);
    const profileEp = TOOL.endpoints.find((e) => e.is_profile)!;
    const body = FIXTURE[profileEp.key]!.success.body;

    const p = svc.extractProfile(combined as never, TOOL as never);
    expect(p.ok).toBe(true);
    for (const field of ['name', 'phone', 'code'] as const) {
      const path = profileEp.profile_map?.[field];
      expect({ field, mapped: !!path }).toEqual({ field, mapped: true });
      expect({ field, value: p[field] }).toEqual({
        field,
        value: String(getNestedResilient(body, path)),
      });
      expect(p[field]).not.toBe('N/A');
    }
  });
});

describe('[LOANV1FIXTURE] the loan_v1 provider path table matches the real profile', () => {
  const profileKey = TOOL.endpoints.find((e) => e.is_profile)!.key;
  const body = FIXTURE[profileKey]!.success.body as Record<string, unknown>;
  const root = LOAN_V1_PATHS.rootPaths
    .map((p) => getNestedResilient(body, p))
    .find((v) => v && typeof v === 'object') as
    Record<string, unknown> | undefined;

  it('the container declared by rootPaths exists', () => {
    expect(root).toBeDefined();
  });

  /* PRESENCE, not truthiness: `warranty_expire_date` is a real `null`. */
  it.each(
    Object.entries(LOAN_V1_PATHS.fieldPaths).map(
      ([k, d]) => [k, d.paths[0]!] as const,
    ),
  )('%s → %s exists in the real profile', (field, path) => {
    const parts = path.split('.');
    const leaf = parts.pop()!;
    const parent = parts.reduce<unknown>(
      (o, k) =>
        o && typeof o === 'object'
          ? (o as Record<string, unknown>)[k]
          : undefined,
      root,
    );
    expect({
      field,
      path,
      present: !!parent && typeof parent === 'object' && leaf in parent,
    }).toEqual({
      field,
      path,
      present: true,
    });
  });
});
