/**
 * [WRAP-AI W1d] substituteDynamicTags — proves the re-homed substitution produces
 * the SAME substituted suggestion the live askGemini does, with the SAME fake
 * inputs the parity suite uses, without a model or a key.
 *
 * This closes the dyntag gap noted in the W1a spec: the assembler was pure and
 * received a pre-substituted string; here the substitution itself is verified
 * against the same helpers and fixtures rag-engine-parity.spec.ts trusts.
 *
 * Because `substituteDynamicTags` imports the very helpers askGemini calls
 * (buildDynamicTagQuery / pickApiSource / computeDynamicTagValue /
 * findUnknownTagMarkers), "same helpers + same inputs → same output" is a
 * transcription-order check, and any drift in the sequence shows here.
 *
 * ⚠️ NO NETWORK, NO KEY, NO REAL DB — the finder is a fake, same as the parity spec.
 */
import {
  bindActiveProvider,
  buildCustomerProviderRegistry,
  resetActiveProvider,
} from '@/modules/customer-provider';
import { substituteDynamicTags } from '@/modules/webhook/ai-reply/reply-dyntag';
import type {
  DynamicTagFinder,
  DynamicTagFormatDeps,
} from '@/modules/webhook/ai-reply/reply-dyntag';

import { LOAN_FIXTURE, loanCombined } from '../lib/loan-v1-upstream';

/* [FEAT-20261014-BASETAGS] the loan upstream helper drives the mocked axios default export */
jest.mock('axios');

// ── the same fake format deps the parity suite feeds the service ────────────
const applyFormat = jest.fn(
  (
    raw: unknown,
    ctx: { field: string },
    translate: (dict: string, key: unknown) => string | null,
  ) => (ctx.field === 'status' ? translate('acc_status', raw) : null),
);
const translate = jest.fn((_dict: string, key: unknown) =>
  key === 'enable' ? 'เปิดใช้งาน' : null,
);
const formatDeps: DynamicTagFormatDeps = { applyFormat, translate };

function finderOf(rows: unknown[]): DynamicTagFinder {
  return {
    find: () => ({ lean: () => Promise.resolve(rows as never) }),
  };
}
function failingFinder(): DynamicTagFinder {
  return {
    find: () => ({ lean: () => Promise.reject(new Error('db down')) }),
  };
}

const dictOpts = { tool: null, scope: null };

describe('[WRAP-AI W1d] base-tag substitution from the profile', () => {
  it('replaces [[[Total_terms_remain]]] etc. from installment data', async () => {
    const profile = {
      'Path : api/line/v1/installment_current.php': {
        data: {
          installment: { Total_terms: 12, current_term: 5, number: 'A9' },
        },
      },
    };
    const r = await substituteDynamicTags(
      {
        suggestionText:
          'เหลือ [[[Total_terms_remain]]] งวด เลขที่ [[[ins_number]]]',
        profileData: profile,
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      finderOf([]),
      formatDeps,
    );
    // 12 - 5 = 7 remaining; number A9
    expect(r.substitutedSuggestion).toBe('เหลือ 7 งวด เลขที่ A9');
    expect(r.tagsLoaded).toBe(true);
  });
});

describe('[WRAP-AI W1d] dynamic-tag substitution via the helpers', () => {
  it('resolves a status tag through applyFormat/translate (เปิดใช้งาน)', async () => {
    const r = await substituteDynamicTags(
      {
        suggestionText: 'สถานะบัญชี acc_status_1 ตอนนี้',
        profileData: { CUSTOMER: { data: { status: 'enable' } } },
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      finderOf([
        { tag: 'acc_status_1', value: 'data.status', sub_type: 'CUSTOMER' },
      ]),
      formatDeps,
    );
    expect(r.substitutedSuggestion).toContain('เปิดใช้งาน');
    expect(r.substitutedSuggestion).not.toContain('acc_status_1');
  });

  it('an unknown marker is reported once, resolved ones are not', async () => {
    const r = await substituteDynamicTags(
      {
        suggestionText: 'ยอด odk_x_777 และ odk_x_777 บาท',
        profileData: { CUSTOMER: { data: { status: 'enable' } } },
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      // one KNOWN tag exists (ins_x_1) but the text uses an UNKNOWN one (odk_x_777)
      finderOf([
        { tag: 'ins_x_1', value: 'data.profile.status', sub_type: 'CUSTOMER' },
      ]),
      formatDeps,
    );
    // deduped to one unknown marker
    const unique = [...new Set(r.mismatchedMarkers)];
    expect(unique).toContain('odk_x_777');
    expect(unique).toHaveLength(1);
  });

  it('a missing source or a compute throw resolves to N/A, never throws', async () => {
    const r = await substituteDynamicTags(
      {
        suggestionText: 'ค่า miss_x_1 นี้',
        profileData: {}, // no source for the tag
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      finderOf([{ tag: 'miss_x_1', value: 'data.nope', sub_type: 'CUSTOMER' }]),
      formatDeps,
    );
    expect(r.substitutedSuggestion).toContain('N/A');
    expect(r.substitutedSuggestion).not.toContain('miss_x_1');
  });
});

describe('[WRAP-AI W1d] compute-error side-effect (divergence D2 — was dropped)', () => {
  // ⚠️ before-test (W0) never covered this: askGemini writes ONE
  //    `dynamic_tag_calculation_error` webhook_logs row when a tag FORMULA throws
  //    (askGemini:1510). The first W1d cut dropped it. These prove the re-homed
  //    dyntag writes the SAME row through the injected logSink, and that the
  //    resolved value is still 'N/A' (no reply-text change).
  it('a tag formula that throws → logSink writes the calc-error row, value = N/A', async () => {
    const createLog = jest.fn(() => Promise.resolve({}));
    const logSink = { createLog };
    const r = await substituteDynamicTags(
      {
        // division by zero → computeDynamicTagValue throws (rag-engine:34)
        suggestionText: 'อัตรา calc_x_1 ต่อเดือน',
        profileData: { CUSTOMER: { data: { num: 10, den: 0 } } },
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      finderOf([
        { tag: 'calc_x_1', value: 'data.num/data.den', sub_type: 'CUSTOMER' },
      ]),
      formatDeps,
      logSink,
    );
    // reply text unchanged: the tag resolves to N/A exactly as askGemini
    expect(r.substitutedSuggestion).toBe('อัตรา N/A ต่อเดือน');
    // …but the operational row IS written, with the tag+formula in raw_request
    expect(createLog).toHaveBeenCalledTimes(1);
    const row = (
      createLog.mock.calls[0] as unknown as [
        { action_type: string; raw_request: { tag: string; formula: string } },
      ]
    )[0];
    expect(row.action_type).toBe('dynamic_tag_calculation_error');
    expect(row.raw_request).toMatchObject({
      tag: 'calc_x_1',
      formula: 'data.num/data.den',
    });
  });

  it('no logSink passed → still resolves to N/A, simply no row written (pure use)', async () => {
    const r = await substituteDynamicTags(
      {
        suggestionText: 'อัตรา calc_x_1 ต่อเดือน',
        profileData: { CUSTOMER: { data: { num: 10, den: 0 } } },
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      finderOf([
        { tag: 'calc_x_1', value: 'data.num/data.den', sub_type: 'CUSTOMER' },
      ]),
      formatDeps,
      // logSink omitted
    );
    expect(r.substitutedSuggestion).toBe('อัตรา N/A ต่อเดือน');
  });
});

describe('[WRAP-AI W1d] fail-open on a DB error (the false-alarm guard)', () => {
  // ⚠️ CORRECTED semantics (2026-08-13, matched to askGemini:1414-1553):
  // `tagsLoaded` does NOT gate the SCAN — it gates the downstream REPORT
  // (`reportTagMismatch`, which the provider calls and which early-returns on
  //  `!tagsLoaded`). So with a truthy profile, a failed fetch STILL scans and
  //  STILL fills mismatchedMarkers; the markers are simply never reported.
  //  Legacy's own comment says the flag "guards against false ALARMS" — the
  //  alarm is the log/report step, not the scan. reply-dyntag returns the raw
  //  markers + tagsLoaded=false so the caller can make the same gate decision.
  it('truthy profile + failed fetch → tagsLoaded false, markers STILL scanned (report gates later)', async () => {
    const r = await substituteDynamicTags(
      {
        suggestionText: 'มี unknown_x_9 อยู่',
        profileData: {}, // truthy → the dyntag block runs; fetch then throws
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      failingFinder(),
      formatDeps,
    );
    // fetch failed → tagsLoaded false; the CALLER (reportTagMismatch) suppresses
    expect(r.tagsLoaded).toBe(false);
    // but the scan itself ran (known set empty → the marker looks unknown), same
    // as askGemini, whose mismatchedMarkers array is filled here too
    expect(r.mismatchedMarkers).toEqual(['unknown_x_9']);
    // nothing resolvable, so the text is returned untouched
    expect(r.substitutedSuggestion).toBe('มี unknown_x_9 อยู่');
  });

  it('a NULL profile → the whole block is skipped (legacy `if (profileData)` gate)', async () => {
    const r = await substituteDynamicTags(
      {
        suggestionText: 'มี [[[total_due_amount]]] และ unknown_x_9 อยู่',
        profileData: null, // falsy → askGemini touches NOTHING
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      // even if the finder WOULD succeed, a null profile never reaches it
      finderOf([{ tag: 'unknown_x_9', value: 'data.x', sub_type: 'CUSTOMER' }]),
      formatDeps,
    );
    // block skipped: no fetch, no base-tag blanking, no scan
    expect(r.tagsLoaded).toBe(false);
    expect(r.mismatchedMarkers).toHaveLength(0);
    // ⚠️ the base tag is NOT blanked — markers survive intact, exactly as legacy
    expect(r.substitutedSuggestion).toBe(
      'มี [[[total_due_amount]]] และ unknown_x_9 อยู่',
    );
  });
});

describe('[WRAP-AI W1d] pure — no substitution when nothing matches', () => {
  it('returns the suggestion unchanged when no tag is present', async () => {
    const r = await substituteDynamicTags(
      {
        suggestionText: 'ข้อความธรรมดาไม่มี tag',
        profileData: null,
        hookId: 'h',
        hookGroupId: 'g',
        dictOpts,
      },
      finderOf([]),
      formatDeps,
    );
    expect(r.substitutedSuggestion).toBe('ข้อความธรรมดาไม่มี tag');
    expect(r.mismatchedMarkers).toHaveLength(0);
  });
});

/* ── [FEAT-20261014-BASETAGS] D1 — the six legacy markers on the LOAN site ───────────────
   They read legacy's literal `Path : …` keys, which a custom-tool hook never has, so on the
   loan site every one answered '' (or 0). loan_v1 now declares, in its own folder
   (`providers/loan-v1/base-tags.ts`), which endpoint KEY and path each reads — the same
   `{ sub_type, value }` shape a dynamic tag uses, resolved by the same engine (formulas
   included). Driven with the partner's REAL answers through the real engine. */
describe('[BASETAGS] D1 — the six legacy markers, declared per provider', () => {
  const SIX =
    '[[[total_due_amount]]]|[[[ins_due_date]]]|[[[due_date]]]|[[[ins_number]]]|[[[ins_current_amount]]]|[[[Total_terms_remain]]]';
  const run = async (profileData: Record<string, unknown>) =>
    (
      await substituteDynamicTags(
        {
          suggestionText: SIX,
          profileData,
          hookId: 'h',
          hookGroupId: 'g',
          dictOpts,
        },
        finderOf([]),
        formatDeps,
      )
    ).substitutedSuggestion.split('|');
  const body = (k: string) =>
    (
      LOAN_FIXTURE[k]!.success.body as {
        data: Record<string, Record<string, unknown>>;
      }
    ).data;

  afterEach(() => resetActiveProvider());

  it('TARGET: loan_v1 bound — every marker answers the real value from the real answers', async () => {
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
    const combined = await loanCombined('linked');
    const p = body('CUSTOMER_PROFILE')['installment']!;
    const ic = body('INSTALLMENT_CURRENT')['installment']!;
    expect(await run(combined)).toEqual([
      String(p['total_due_amount']),
      String(p['due_date']),
      String(p['due_date']),
      String(ic['number']),
      String(ic['current_amount']),
      String(Number(p['total_terms']) - Number(p['current_term'])),
    ]);
  });

  it('🔴 PIN: unbound (shop-api) — the same custom-tool data still gets legacy’s answers', async () => {
    const combined = await loanCombined('linked');
    expect(await run(combined)).toEqual(['', '', '', '', '', '0']);
  });

  it('🔴 PIN: loan_v1 bound but legacy-shaped data — legacy values still win where the table finds nothing', async () => {
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
    const legacy = {
      'Path : api/line/v1/installment_current.php': {
        data: {
          installment: { Total_terms: 12, current_term: 5, number: 'A9' },
        },
      },
    };
    const out = await run(legacy);
    expect(out[3]).toBe('A9');
    expect(out[5]).toBe('7');
  });

  it('🔴 PIN: the table finds the endpoint but not the field — legacy’s value is kept, not blanked', async () => {
    /* added after mutation D1b survived: an N/A from the table must never overwrite a value
       legacy already produced */
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
    const out = await run({
      'Path : api/line/v1/installment_current.php': {
        data: {
          installment: { Total_terms: 12, current_term: 5, number: 'A9' },
        },
      },
      INSTALLMENT_CURRENT: {
        success: true,
        data: { data: { installment: {} } },
      },
    });
    expect(out[3]).toBe('A9');
  });
});
