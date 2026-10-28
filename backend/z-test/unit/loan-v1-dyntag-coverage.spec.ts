/**
 * [FLOWTEST-20261018-LOANDYNTAGCOVER] Every value the loan partner answers can be a dynamic tag.
 * ============================================================================
 * Owner 18/10/2026: "dynamic tag รองรับทุกค่าหรือยังของเส้น loan". The 15 seeded tags are
 * pinned in `loan-v1-fixture-guard.spec.ts`; this file proves the ENGINE resolves EVERY leaf of
 * the real answers (5 data endpoints, ~184 leaves) — not just the ones someone already tagged.
 *
 * Runs the SHIPPED code end to end, never a copy of its rule:
 *   `CustomToolService.getCombinedData` (real tool snapshot, axios mocked with the real answers)
 *   → `pickApiSource` (tag → endpoint by KEY) → `computeDynamicTagValue` (the value the
 *   customer reads). The EXPECTED value is read straight from the fixture body by this file's
 *   own walker, so the engine is compared against the data, not against itself.
 *
 * Current behaviour, pinned as found (owner: "ปัจจุบันเป็นแบบไหนทำแบบนั้น ห้ามกระทบ"):
 *   · null / missing ⇒ `N/A` (`rag-engine.service.ts` — `rawVal !== null ? String(rawVal) : 'N/A'`)
 *   · number / string / boolean ⇒ `String(value)`
 *   · a value containing HTML tags ⇒ tags stripped (the engine's "Smart Strip HTML")
 *   · a 2-term formula ⇒ `result.toString()`
 *
 * R10: axios is mocked; nothing leaves the process.
 */
import { computeDynamicTagValue, pickApiSource } from '@/modules/ai';

import {
  LOAN_FIXTURE,
  answerWith,
  makeLoanToolService,
} from '../lib/loan-v1-upstream';

jest.mock('axios');

const HOOK = { _id: 'h1', alias: 'loan-oa' } as never;
const UID = 'U00000000000000000000000000000000';

/** a leaf is a primitive by construction — the walker recurses into every array/object */
type Prim = string | number | boolean | null | undefined;
type Leaf = { key: string; path: string; raw: Prim };

/** This file's own walker over the REAL answer body: `data.a.b`, arrays as `[0]` and `[last]`. */
function leavesOf(key: string, node: unknown, path: string, out: Leaf[]): void {
  if (Array.isArray(node)) {
    if (node.length === 0) return;
    const idx = node.length === 1 ? [0] : [0, node.length - 1];
    for (const i of idx) leavesOf(key, node[i], `${path}[${i}]`, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      leavesOf(key, v, path ? `${path}.${k}` : k, out);
    }
    return;
  }
  out.push({ key, path, raw: node as Prim });
}

const LEAVES: Leaf[] = [];
for (const [key, f] of Object.entries(LOAN_FIXTURE)) {
  const body = (f as { success?: { body?: { data?: unknown } } }).success?.body;
  if (body?.data !== undefined) leavesOf(key, body.data, 'data', LEAVES);
}

/** What the customer reads for this raw value, per the behaviour pinned above. */
const expected = (raw: Prim): string => {
  if (raw === null || raw === undefined) return 'N/A';
  const s = String(raw);
  return /<[^>]*>/.test(s) ? s.replace(/<[^>]*>/g, '').trim() : s;
};

let combined: Record<string, unknown>;
beforeAll(async () => {
  const svc = await makeLoanToolService();
  answerWith((f) => f.success);
  combined = await svc.getCombinedData(UID, HOOK);
});

const resolve = (key: string, value: string) => {
  const tag = { tag: 'ins_x_cover', sub_type: key, value };
  return computeDynamicTagValue(pickApiSource(combined, tag), tag);
};

describe('[LOANDYNTAGCOVER] the walk found the real answers', () => {
  it('5 data endpoints, every one with leaves, ≥184 values in total', () => {
    const keys = new Set(LEAVES.map((l) => l.key));
    expect([...keys].sort()).toEqual([
      'ALL_INSTALLMENTS',
      'CONTRACT_INFO',
      'CUSTOMER_PROFILE',
      'INSTALLMENT_CURRENT',
      'PAYMENT_HISTORY',
    ]);
    expect(LEAVES.length).toBeGreaterThanOrEqual(184);
  });
});

describe('[LOANDYNTAGCOVER] ⭐ every leaf resolves to exactly what the partner sent', () => {
  it.each(LEAVES.map((l) => [l.key, l.path, l.raw] as const))(
    '%s → %s',
    (key, path, raw) => {
      expect({ key, path, shown: resolve(key, path) }).toEqual({
        key,
        path,
        shown: expected(raw),
      });
    },
  );
});

describe('[LOANDYNTAGCOVER] each kind of value, named', () => {
  const firstOf = (pred: (l: Leaf) => boolean) => {
    const l = LEAVES.find(pred);
    if (!l) throw new Error('the real answers carry no such value');
    return l;
  };
  it('boolean ⇒ "true" / "false"', () => {
    const l = firstOf((x) => typeof x.raw === 'boolean');
    expect(resolve(l.key, l.path)).toBe(String(l.raw));
  });
  it('🔴 null ⇒ N/A (today’s behaviour, kept)', () => {
    const l = firstOf((x) => x.raw === null);
    expect(resolve(l.key, l.path)).toBe('N/A');
  });
  it('an array row by index — first and last row of payment history', () => {
    const first = firstOf((x) => /^data\.history\[0\]\.amount$/.test(x.path));
    const last = LEAVES.filter((x) =>
      /^data\.history\[\d+\]\.amount$/.test(x.path),
    ).pop()!;
    expect(resolve(first.key, first.path)).toBe(String(first.raw));
    expect(resolve(last.key, last.path)).toBe(String(last.raw));
  });
  it('a 2-term formula on the current installment', () => {
    const remain = firstOf(
      (x) =>
        x.key === 'INSTALLMENT_CURRENT' &&
        x.path === 'data.installment.remain_amount',
    );
    const mulct = firstOf(
      (x) =>
        x.key === 'INSTALLMENT_CURRENT' &&
        x.path === 'data.installment.mulct_amount',
    );
    expect(
      resolve(
        'INSTALLMENT_CURRENT',
        'data.installment.remain_amount - data.installment.mulct_amount',
      ),
    ).toBe((Number(remain.raw) - Number(mulct.raw)).toString());
  });
  it('a path the partner does not send ⇒ N/A', () => {
    expect(resolve('CUSTOMER_PROFILE', 'data.customer.no_such_field')).toBe(
      'N/A',
    );
  });
  it('the sub type is the endpoint KEY, case-insensitive (tool-agnostic: any company’s tool with the same keys)', () => {
    const l = firstOf((x) => x.key === 'CONTRACT_INFO');
    expect(resolve('contract_info', l.path)).toBe(expected(l.raw));
  });
});
