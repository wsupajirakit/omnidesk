/**
 * [FIX-20260901-TAGESCAPE] The OUTPUT-side dynamic-tag pass, and the two families.
 * ===========================================================================
 * WHAT THIS FILE HOLDS. `substituteDynamicTags` now hands the caller back the
 * SAME substitution it just ran over the Training Document, as
 * `substituteEscapedTags`, so the model's OWN answer can be put through it. The
 * gemini provider applies it to `response.text` on the success path, after
 * `interpretReply` and BEFORE the outbound `findUnknownTagMarkers` scan.
 *
 * THE DEFECT IT CLOSES. `resolveReplyTags`'s `[FIX-20260807-NOMARKERLEAK]`
 * catch-all deletes EVERY `[[…]]` it does not recognise. A tag the model echoed
 * back — and it echoes them, because the Training Document teaches the syntax by
 * example — was therefore DELETED rather than substituted, and the customer read
 * the sentence with the number missing:
 *
 *     model answer      "ฝากขั้นต่ำ [[odk_s_00001]] บาท"
 *     without the pass  "ฝากขั้นต่ำ บาท"        ← the amount, gone
 *     with the pass     "ฝากขั้นต่ำ 100 บาท"
 *
 * ⚠️ THE LOAD-BEARING GROUP IS THE FAMILY MATRIX, not the rescue. `odk_s_*`
 *    (`sub_type: SITE_RULES`, 350 rows) describes the WEBSITE — the deposit
 *    minimum is a property of the shop, not of any customer — while `odk_p_*`
 *    (`sub_type: CUSTOMER_PROFILE`, 451 rows) describes THIS customer. A site
 *    rule must therefore answer for a visitor who has never linked an account.
 *    ⇒ site rule ต้องตอบได้แม้ไม่มีโปรไฟล์ลูกค้า สองตระกูลนี้ห้ามผูกกัน
 *
 * ⚠️ FIXTURE SHAPES ARE NOT INVENTED. The bag is keyed by ENDPOINT KEY and each
 *    slot is wrapped `{ success, status, data, duration, is_profile, role }` —
 *    `external/custom-tool.service.ts:1358`. `pickApiSource` looks up
 *    `Path : <sub_type>` then `<sub_type>` verbatim, and a FAILED endpoint keeps
 *    its key with `success:false` rather than vanishing. The payload shapes and
 *    the tag `value` paths below are the ones measured against the real
 *    `dynamic_tags` collection by `z-test/manual/prove-tag-escape-truth.ts`.
 *
 * ⚠️ NO DATABASE, NO NETWORK, NO KEY — the finder is a fake, the same shape
 *    `wrap-ai-w1d-dyntag.spec.ts` uses. This file does not repeat that spec's
 *    cases (base tags, the mismatch scan, the DB-failure fail-open, the null-
 *    profile gate on the DOCUMENT); it covers only what the second pass adds.
 */
import { substituteDynamicTags } from '@/modules/webhook/ai-reply/reply-dyntag';
import type {
  DynamicTagFinder,
  DynamicTagFormatDeps,
} from '@/modules/webhook/ai-reply/reply-dyntag';
import { resolveReplyTags } from '@/modules/webhook/hook-reply/reply-tags.util';

// ── the same fake format deps the parity suite feeds the service ────────────
// Kept identical to `wrap-ai-w1d-dyntag.spec.ts` on purpose: the call COUNT on
// `applyFormat` is what proves the memoisation below, so it must be the real
// formatter seam and not a stub invented for this file.
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

const dictOpts = { tool: null, scope: null };

// ── the two families, one real row each ─────────────────────────────────────
const WEB_CODE = 'DEMO9';
const DEPOSIT_MIN = '100';

/** `odk_p_*` — about THIS customer. */
const PROFILE_TAG = {
  tag: 'odk_p_00001',
  value: 'data.profile.web_code',
  sub_type: 'CUSTOMER_PROFILE',
};
/** `odk_s_*` — about the WEBSITE. Needs no customer at all. */
const SITE_TAG = {
  tag: 'odk_s_00001',
  value: 'data.shop.wallet.wallet_setting.deposit_amount_min',
  sub_type: 'SITE_RULES',
};
const BOTH_ROWS = [PROFILE_TAG, SITE_TAG];

/**
 * One endpoint's slot in the bag, in the live wrapper shape
 * (`custom-tool.service.ts:1358`). A failed call keeps the key and swaps the
 * body for an error message — it does NOT disappear, which is exactly why the
 * `profile FAILED` row below is a different case from `profile MISSING`.
 */
const slot = (isProfile: boolean, data: unknown, ok = true) => ({
  success: ok,
  status: ok ? 200 : 404,
  duration: 11,
  is_profile: isProfile,
  role: isProfile ? 'customer_profile' : 'site_rules',
  data: ok ? data : { message: 'not found' },
});
const profileSlot = (ok = true) =>
  slot(true, { profile: { web_code: WEB_CODE } }, ok);
const siteSlot = (ok = true) =>
  slot(
    false,
    { shop: { wallet: { wallet_setting: { deposit_amount_min: 100 } } } },
    ok,
  );

/** Both tags in one sentence, so each case reads as a row of the matrix. */
const BOTH_TAGS_TEXT = `ฝาก [[${SITE_TAG.tag}]] รหัส [[${PROFILE_TAG.tag}]]`;

const run = (
  suggestionText: string,
  profileData: Record<string, unknown> | null,
  rows: unknown[] = BOTH_ROWS,
  logSink?: { createLog: jest.Mock },
) =>
  substituteDynamicTags(
    { suggestionText, profileData, hookId: 'h', hookGroupId: 'g', dictOpts },
    finderOf(rows),
    formatDeps,
    logSink,
  );

beforeEach(() => {
  applyFormat.mockClear();
  translate.mockClear();
});

describe('[FIX-20260901-TAGESCAPE] the two tag families resolve independently', () => {
  // 🔴 THE OWNER'S CASE. Nobody linked an account, so `getCombinedData` returns a
  //    bag with no profile key at all. The deposit minimum is still a fact about
  //    the shop and must still answer. A regression here is invisible to every
  //    other spec, because they all pass a bag that HAS a profile.
  //    ป้าย site rules ต้องไม่ต้องพึ่งโปรไฟล์ลูกค้า
  it('⭐⭐⭐ a SITE_RULES tag resolves with NO customer profile in the bag', async () => {
    const r = await run(BOTH_TAGS_TEXT, { SITE_RULES: siteSlot() });
    expect(r.substitutedSuggestion).toBe(`ฝาก ${DEPOSIT_MIN} รหัส N/A`);
  });

  // The profile endpoint answered 404. `pickApiSource` does not read `success`,
  // so the slot is still picked — it simply carries an error body, which degrades
  // the PROFILE tag to N/A. The SITE_RULES tag reads a different key and is
  // untouched by any of that.
  it('⭐⭐⭐ a SITE_RULES tag resolves when the profile slot is present but success:false', async () => {
    const r = await run(BOTH_TAGS_TEXT, {
      CUSTOMER_PROFILE: profileSlot(false),
      SITE_RULES: siteSlot(),
    });
    expect(r.substitutedSuggestion).toBe(`ฝาก ${DEPOSIT_MIN} รหัส N/A`);
  });

  // …and the mirror image, so "independent" is proved in both directions rather
  // than only in the direction the defect happened to point.
  it('⭐⭐⭐ a CUSTOMER_PROFILE tag resolves when the site-rules slot failed', async () => {
    const r = await run(BOTH_TAGS_TEXT, {
      CUSTOMER_PROFILE: profileSlot(),
      SITE_RULES: siteSlot(false),
    });
    expect(r.substitutedSuggestion).toBe(`ฝาก N/A รหัส ${WEB_CODE}`);
  });

  // An empty bag is TRUTHY, so the gate opens and both tags are resolved — to
  // N/A. The distinction that matters: N/A, not the raw marker. A raw marker
  // would reach the catch-all and be deleted, which is the silent failure.
  it('neither family resolves from an empty bag {} — they become N/A, not raw', async () => {
    const r = await run(BOTH_TAGS_TEXT, {});
    expect(r.substitutedSuggestion).toBe('ฝาก N/A รหัส N/A');
    expect(r.substitutedSuggestion).not.toContain('odk_');
  });
});

describe('[FIX-20260901-TAGESCAPE] the escape, and the rescue', () => {
  const GOOD_BAG = {
    CUSTOMER_PROFILE: profileSlot(),
    SITE_RULES: siteSlot(),
  };
  /** What the model writes back when it copies the syntax it was taught. */
  const MODEL_ANSWER = `ฝากขั้นต่ำ [[${SITE_TAG.tag}]] บาท`;

  // 🔴 THE HEADLINE. The value must arrive, and the assertion names the value —
  //    "no brackets left" would also pass on the deleted-amount sentence, which
  //    is the very bug. ต้องเช็คว่าได้ "100" ไม่ใช่แค่ว่าไม่มีวงเล็บ
  it('⭐⭐⭐ a tag the model echoed arrives with its VALUE through substituteEscapedTags + resolveReplyTags', async () => {
    const r = await run(MODEL_ANSWER, GOOD_BAG);
    const rescued = resolveReplyTags(
      r.substituteEscapedTags(MODEL_ANSWER),
      '',
    ).finalReplyForLine;
    expect(rescued).toBe(`ฝากขั้นต่ำ ${DEPOSIT_MIN} บาท`);
  });

  /* 🔴 RED-FIRST, DOCUMENTED. This is the 01/09 production behaviour, pinned so
     it can never come back unnoticed: the same answer sent STRAIGHT to
     `resolveReplyTags` loses the amount to the catch-all.

     ⚠️ Asserted with `toBe` on the whole sentence on purpose. If somebody
        "fixes" this by deleting the catch-all instead of substituting before it,
        the output becomes `ฝากขั้นต่ำ [[odk_s_00001]] บาท` and THIS case fails —
        which is what must happen, because a raw marker reaching a customer is
        the worse of the two failures. ตัวกวาดต้องอยู่ ห้ามลบทิ้ง */
  it('⭐⭐⭐ the same answer WITHOUT the pass loses the value entirely (the defect)', () => {
    const unrescued = resolveReplyTags(MODEL_ANSWER, '').finalReplyForLine;
    expect(unrescued).toBe('ฝากขั้นต่ำ บาท');
    expect(unrescued).not.toContain(DEPOSIT_MIN);
  });

  // The owner's absolute rule survives the rescue: substituting must not leave a
  // bracket behind, and the catch-all still runs after it.
  it('the rescued reply contains no [[ and no ]]', async () => {
    const r = await run(MODEL_ANSWER, GOOD_BAG);
    const rescued = resolveReplyTags(
      r.substituteEscapedTags(MODEL_ANSWER),
      '',
    ).finalReplyForLine;
    expect(rescued).not.toContain('[[');
    expect(rescued).not.toContain(']]');
  });

  // The last row of the matrix. With a null bag nothing was ever fetched, so
  // there is nothing to rescue with and the catch-all takes the marker — RAW in,
  // GONE out. Stated as a test so the limit of this fix is on the record.
  it('null bag → the echoed tag stays RAW through the identity pass, then the catch-all deletes it', async () => {
    const r = await run(MODEL_ANSWER, null);
    const passed = r.substituteEscapedTags(MODEL_ANSWER);
    expect(passed).toBe(MODEL_ANSWER); // raw — no rows, nothing to substitute
    expect(resolveReplyTags(passed, '').finalReplyForLine).toBe(
      'ฝากขั้นต่ำ บาท',
    );
  });
});

describe('[FIX-20260901-TAGESCAPE] safety properties of the returned pass', () => {
  // ⚠️ The whole safety argument for handing a closure back to the caller: when
  //    the `if (profileIn)` gate never opens, no row was fetched, so the caller's
  //    text must come back BYTE-FOR-BYTE. Not "roughly unchanged" — identical.
  //    ไม่มีข้อมูล = ห้ามแตะข้อความ
  it('⭐⭐⭐ profileData null → substituteEscapedTags is IDENTITY, byte for byte', async () => {
    const text = `[[${SITE_TAG.tag}]] {{${PROFILE_TAG.tag}}} 100% [ดูรูป] \n\n ok`;
    const r = await run('เอกสารเปล่า', null);
    expect(r.substituteEscapedTags(text)).toBe(text);
  });

  // Gate OPEN, rows LOADED, and still not one character moves when the text
  // names no tag — the `.includes` guard inside the pass is what holds this.
  it('a text with no tags at all comes back byte-identical even with rows loaded', async () => {
    const r = await run('เอกสาร', {
      CUSTOMER_PROFILE: profileSlot(),
      SITE_RULES: siteSlot(),
    });
    const text = 'สวัสดีค่ะ ยินดีให้บริการตลอด 24 ชั่วโมง';
    expect(r.substituteEscapedTags(text)).toBe(text);
  });

  /* ⚠️ MEMOISATION IS BEHAVIOUR, NOT AN OPTIMISATION. A tag present in BOTH the
     document and the answer must compute ONCE; a second computation means a
     second `dynamic_tag_calculation_error` row for ONE reply and the operational
     trail starts double-counting. Counted on the injected `applyFormat`, which
     `computeDynamicTagValue` calls exactly once per real computation.
     คำนวณซ้ำ = log ซ้ำ แถวเดียวต่อหนึ่งคำตอบเท่านั้น */
  it('⭐⭐⭐ a tag in BOTH the document and the answer computes ONCE (applyFormat called once)', async () => {
    const r = await run(`ฝากขั้นต่ำ [[${SITE_TAG.tag}]] บาท`, {
      SITE_RULES: siteSlot(),
    });
    expect(applyFormat).toHaveBeenCalledTimes(1); // the document pass
    const out = r.substituteEscapedTags(`ขั้นต่ำ [[${SITE_TAG.tag}]] บาทค่ะ`);
    expect(out).toBe(`ขั้นต่ำ ${DEPOSIT_MIN} บาทค่ะ`); // …still substituted
    expect(applyFormat).toHaveBeenCalledTimes(1); // …from the cache, not recomputed
  });

  /* The same property where it actually costs money: a BROKEN FORMULA. The
     document pass throws, is caught, writes ONE calc-error row and resolves to
     N/A; the answer pass must reuse that N/A rather than throw again and write a
     second row. `wrap-ai-w1d-dyntag.spec.ts` proves the row is written at all —
     this proves it is written exactly once per reply, and that the escape pass
     never throws out at the provider. */
  it('⭐⭐⭐ a formula that THROWS yields N/A in the answer, never throws, and logs ONE row for the reply', async () => {
    const createLog = jest.fn(() => Promise.resolve({}));
    const brokenRow = {
      tag: 'odk_s_00009',
      value: 'data.num/data.den', // division by zero → computeDynamicTagValue throws
      sub_type: 'SITE_RULES',
    };
    const r = await run(
      `อัตรา [[${brokenRow.tag}]] ต่อเดือน`,
      { SITE_RULES: slot(false, { num: 10, den: 0 }) },
      [brokenRow],
      { createLog },
    );
    expect(r.substitutedSuggestion).toBe('อัตรา N/A ต่อเดือน');

    let out = '';
    expect(() => {
      out = r.substituteEscapedTags(`อัตราคือ [[${brokenRow.tag}]] ค่ะ`);
    }).not.toThrow();
    expect(out).toBe('อัตราคือ N/A ค่ะ');
    // ONE row for the whole reply — not one per pass.
    expect(createLog).toHaveBeenCalledTimes(1);
  });
});
