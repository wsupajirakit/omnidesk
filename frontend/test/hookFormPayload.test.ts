/* [FEAT-20260817-FORMDIFF] The hook form must send only what the operator
 * actually changed.
 *
 * BEFORE: pressing save posted all 83 form fields, so "rename a hook" rewrote
 * the whole document — discarding whatever another admin had saved in the
 * meantime, and (before the backend guard landed) erasing any secret the form
 * had failed to load.
 *
 * AFTER: the payload is built exactly as before, then diffed against a snapshot
 * of the populated form. A member that is absent from the body is left alone by
 * the API — RFC 7386 merge-patch semantics, which is what PUT /hook/:id
 * implements via its field whitelist.
 *
 * These are behaviour tests against the real functions, not source pins: break
 * any rule below and the assertion fails on the value, not on a grep.
 *
 * NOTE ON WORDING: "hook" is the entity. The UI calls it an OA because every
 * hook is a LINE OA today, but the payload rules here are per-hook and say
 * nothing about which channel it speaks — a future non-LINE channel changes no
 * assertion in this file.
 */
import { describe, it, expect } from 'vitest';
import {
  buildHookPayload,
  diffHookPayload,
  normalizeHookSubmission,
  sameValue,
} from '../utils/hookFormPayload';
import { SECRET_MASK } from '../utils/secretMask';

/** A form as it looks after loading a configured hook. */
const loadedForm = (over: Record<string, any> = {}) => ({
  line_oa_name: 'Zee Product',
  alias: 'demo-shop',
  company_name: 'Zee',
  group_id: 'g1',
  description: 'desc',
  status: 1,
  fast_mode: 1,
  // every configured secret comes back masked — the API never ships the real one
  channel_secret: SECRET_MASK,
  access_token: SECRET_MASK,
  custom_ai_key: SECRET_MASK,
  // [FEAT-20260904-VENDORSECCOL] the second vendor's key is masked on read too.
  custom_ai_key_sec: SECRET_MASK,
  slip_verify_key: SECRET_MASK,
  telegram_key: SECRET_MASK,
  telegram_chat_id: '-1001',
  telegram_noti_type: 'all',
  tag: ['a', 'b'],
  callback_slip: ['https://x.test/cb'],
  flex_custom_ids: ['f1'],
  flex_profile_custom_ids: [],
  payment_flex_ids: { paid: 'p1' },
  gemini_temperature: 0.5,
  gemini_top_k: 20,
  gemini_top_p: 0.9,
  gemini_thinking_budget: 0,
  auto_unassist_minutes: 30,
  answer_link: 'https://x.test',
  customer_helper_text: 'help',
  slip_require_profile: true,
  slip_require_profile_text: 'need profile',
  match_account: false,
  slip_check_min_amount: 10,
  slip_check_max_amount: 1000,
  slip_check_out_of_time: 15,
  customer_link_enabled: true,
  custom_tool_status: true,
  custom_tool_id: 'ct1',
  payment_tool_status: false,
  payment_tool_id: null,
  walletpay_tool_status: false,
  walletpay_tool_id: null,
  flex_profile_id: 'fp1',
  flex_customerhelper_id: null,
  ...over,
});

const boxes = { general: 'general text', company: 'company text', noProfile: 'noprofile text' };
const EDIT = { isCreate: false };

/** What the modal does on submit: build, then diff against the loaded snapshot. */
const submit = (
  current: Record<string, any>,
  baselineForm: Record<string, any> | null,
  currentBoxes = boxes,
  baselineBoxes = boxes,
) =>
  diffHookPayload(
    buildHookPayload(current, currentBoxes, EDIT),
    baselineForm ? buildHookPayload(baselineForm, baselineBoxes, EDIT) : null,
  );

describe('[FEAT-20260817-FORMDIFF] only edited fields reach the API', () => {
  it('T1 — open the form and save without touching anything: sends NOTHING', () => {
    const form = loadedForm();
    expect(submit(form, form)).toEqual({});
  });

  it('T1b — a second, independently built object still counts as unchanged', () => {
    // guards against identity comparison: the arrays/objects are rebuilt here
    expect(submit(loadedForm(), loadedForm())).toEqual({});
  });

  it('T2 — focusing a secret box without typing sends no secret', () => {
    const diff = submit(loadedForm(), loadedForm());
    for (const f of ['channel_secret', 'access_token', 'custom_ai_key', 'slip_verify_key', 'telegram_key']) {
      expect(diff).not.toHaveProperty(f);
    }
  });

  it('T3 — renaming the hook sends that field ONLY', () => {
    const diff = submit(loadedForm({ line_oa_name: 'Zee Product 2' }), loadedForm());
    expect(diff).toEqual({ line_oa_name: 'Zee Product 2' });
  });

  it('T4 — changing credentials only sends the credential only', () => {
    const diff = submit(loadedForm({ channel_secret: 'brand-new-secret' }), loadedForm());
    expect(diff).toEqual({ channel_secret: 'brand-new-secret' });
  });

  it('T5 — a mixed edit sends exactly the three changed fields', () => {
    const diff = submit(
      loadedForm({ line_oa_name: 'New', custom_ai_key: 'AIzaNEW', match_account: true }),
      loadedForm(),
    );
    expect(diff).toEqual({ line_oa_name: 'New', custom_ai_key: 'AIzaNEW', match_account: true });
  });

  it('T6 — editing then reverting before save sends nothing', () => {
    const baseline = loadedForm();
    const touched = loadedForm({ line_oa_name: 'typo' });
    const reverted = { ...touched, line_oa_name: baseline.line_oa_name };
    expect(submit(reverted, baseline)).toEqual({});
  });

  it('T7 — the other admin\'s edits are not overwritten: an untouched field is never sent', () => {
    // Admin A holds a form loaded before B changed the prompt. A renames only.
    const aBaseline = loadedForm();
    const diff = submit(loadedForm({ line_oa_name: 'renamed by A' }), aBaseline);
    // B's field is absent from the body ⇒ the API leaves B's value in place.
    expect(Object.keys(diff)).toEqual(['line_oa_name']);
    expect(diff).not.toHaveProperty('suggestion_text');
    expect(diff).not.toHaveProperty('customer_helper_text');
  });

  it('T7b — a training-doc edit by A still does not carry A\'s stale other fields', () => {
    const diff = submit(loadedForm(), loadedForm(), { ...boxes, general: 'rewritten' }, boxes);
    expect(diff).toEqual({ suggestion_text: 'rewritten' });
  });

  it('T8 — switching a toggle off is sent, so "off" really reaches the database', () => {
    expect(submit(loadedForm({ custom_tool_status: false }), loadedForm())).toEqual({
      custom_tool_status: false,
    });
    expect(submit(loadedForm({ slip_require_profile: false }), loadedForm())).toEqual({
      slip_require_profile: false,
    });
  });

  it('T9 — a blank secret box is OMITTED, never sent as null', () => {
    // telegram_key blank: secretForSubmit drops it, so it cannot be seen as an edit
    const diff = submit(loadedForm({ telegram_key: '' }), loadedForm());
    expect(diff).not.toHaveProperty('telegram_key');
    expect(Object.values(diff)).not.toContain(null);
  });

  it('T10b — an EDIT with no baseline REFUSES to send rather than posting defaults', () => {
    const full = buildHookPayload(loadedForm(), boxes, EDIT);
    // create/clone: no baseline is normal, send everything
    expect(() => diffHookPayload(full, null)).not.toThrow();
    // edit: no baseline means the form never loaded the hook it claims to edit —
    // sending blank defaults over a live document must never happen silently
    expect(() => diffHookPayload(full, null, { requireBaseline: true })).toThrow();
    // and it still diffs normally once a baseline exists
    expect(diffHookPayload(full, full, { requireBaseline: true })).toEqual({});
  });

  it('T10 — create and clone have no baseline and still send everything', () => {
    const full = buildHookPayload(loadedForm(), boxes, EDIT);
    const diff = diffHookPayload(full, null);
    expect(diff).toEqual(full);
    expect(Object.keys(diff).length).toBeGreaterThan(30);
  });

  it('T11 — array fields are deep-compared: unchanged arrays are not sent', () => {
    expect(submit(loadedForm(), loadedForm())).not.toHaveProperty('tag');
    expect(submit(loadedForm({ tag: ['a', 'b', 'c'] }), loadedForm())).toEqual({
      tag: ['a', 'b', 'c'],
    });
    expect(submit(loadedForm({ callback_slip: [] }), loadedForm())).toEqual({ callback_slip: [] });
  });

  it('T11b — nested objects are deep-compared too', () => {
    expect(submit(loadedForm(), loadedForm())).not.toHaveProperty('payment_flex_ids');
    expect(submit(loadedForm({ payment_flex_ids: { paid: 'p2' } }), loadedForm())).toEqual({
      payment_flex_ids: { paid: 'p2' },
    });
  });

  it('normalised values are compared, not raw form state', () => {
    // '' and null both normalise to null for an ObjectId select → not an edit
    expect(submit(loadedForm({ payment_tool_id: '' }), loadedForm({ payment_tool_id: null }))).toEqual({});
    // an untrimmed retype of the same text is not an edit either
    expect(submit(loadedForm({ answer_link: ' https://x.test ' }), loadedForm())).toEqual({});
  });
});

/* [FEAT-20260817-FORMDIFF] The features the owner asked about by name.
 *
 * None of them has a dedicated code path in the diff — they ride the generic rule —
 * which is exactly why they are pinned here: "it should be fine because it is generic"
 * is reasoning, and reasoning is what this file exists to replace.
 *
 * The backend side of each was read before writing these:
 *   · customer_link_enabled / _landing_url / _web_code are plain ALLOWED_UPDATES
 *     entries with NO handler in updateHook — nothing recomputes when they are absent.
 *     (customer_link_password IS a masked secret but is NOT in ALLOWED_UPDATES, so the
 *     PUT cannot write it at all and the form never holds it.)
 *   · line_oa_name ↔ display_name and line_url ↔ oa_url are mirrored by
 *     mirrorHookChannelFields, which only acts on members that are PRESENT — so a
 *     rename still mirrors, and an untouched name mirrors nothing, as before.
 *   · group is only re-resolved and re-authorised when the body carries it; the
 *     caller's access to the hook itself is checked against the STORED group earlier
 *     in updateHook, so omitting it cannot widen anyone's access.
 *   · force_grant is read with isTrueFlag(), which reads an absent member as false —
 *     the same answer the old form produced by sending false explicitly.
 */
describe('[FEAT-20260817-FORMDIFF] features that must be untouched by the diff', () => {
  const CUSTOMER_LINK = ['customer_link_enabled', 'customer_link_landing_url', 'customer_link_web_code'];
  const WEBHOOK = ['webhook_url', 'channel_id', 'line_url', 'alias'];

  it('customer link — nothing is sent when the operator did not touch it', () => {
    const form = () => loadedForm({
      customer_link_enabled: true,
      customer_link_landing_url: 'https://land.test/x',
      customer_link_web_code: 'WEBCODE-1',
    });
    const diff = submit(form(), form());
    for (const f of CUSTOMER_LINK) expect(diff).not.toHaveProperty(f);
    expect(diff).toEqual({});
  });

  it('customer link — each field still saves on its own, and moves nothing else', () => {
    const base = () => loadedForm({
      customer_link_enabled: true,
      customer_link_landing_url: 'https://land.test/x',
      customer_link_web_code: 'WEBCODE-1',
    });
    expect(submit({ ...base(), customer_link_landing_url: 'https://land.test/NEW' }, base()))
      .toEqual({ customer_link_landing_url: 'https://land.test/NEW' });
    expect(submit({ ...base(), customer_link_web_code: 'WEBCODE-2' }, base()))
      .toEqual({ customer_link_web_code: 'WEBCODE-2' });
    // turning the feature OFF must reach the API — an omitted `false` would leave it on
    expect(submit({ ...base(), customer_link_enabled: false }, base()))
      .toEqual({ customer_link_enabled: false });
  });

  it('customer link — a landing url cleared to blank is sent, so it really clears', () => {
    const base = loadedForm({ customer_link_landing_url: 'https://land.test/x' });
    expect(submit({ ...base, customer_link_landing_url: '' }, base))
      .toEqual({ customer_link_landing_url: '' });
  });

  it('customer link — the masked password is not a form field at all', () => {
    // it is not in ALLOWED_UPDATES on the backend either; if it ever appears in the
    // form, this fails and whoever added it has to think about the masking rule first
    const full = buildHookPayload(loadedForm(), boxes, EDIT);
    expect(full).not.toHaveProperty('customer_link_password');
    expect(full).not.toHaveProperty('api_key');
  });

  it('webhook identity fields never move on an unrelated save', () => {
    const base = () => loadedForm({
      webhook_url: 'https://wh.test/hook',
      channel_id: 'CHAN-1',
      line_url: 'https://line.me/x',
      alias: 'demo-shop',
    });
    const diff = submit({ ...base(), description: 'edited' }, base());
    expect(diff).toEqual({ description: 'edited' });
    for (const f of WEBHOOK) expect(diff).not.toHaveProperty(f);
  });

  it('renaming still carries the field the backend mirrors display_name from', () => {
    // mirrorHookChannelFields copies line_oa_name → display_name, but only when
    // line_oa_name is PRESENT. A rename must therefore still send it.
    const base = loadedForm();
    expect(submit({ ...base, line_oa_name: 'Renamed' }, base)).toEqual({ line_oa_name: 'Renamed' });
  });

  it('group is sent when the hook is moved and withheld when it is not', () => {
    const base = loadedForm({ group_id: 'g1' });
    expect(submit(loadedForm({ group_id: 'g1' }), base)).toEqual({});
    expect(submit(loadedForm({ group_id: 'g2' }), base)).toEqual({ group_id: 'g2' });
  });

  it('force_grant only travels when the operator actually ticked it', () => {
    const base = loadedForm({ force_grant: false });
    expect(submit(loadedForm({ force_grant: false }), base)).toEqual({});
    expect(submit(loadedForm({ force_grant: true }), base)).toEqual({ force_grant: true });
  });
});

describe('[FEAT-20260817-FORMDIFF] buildHookPayload keeps the coercions it inherited', () => {
  const built = buildHookPayload(loadedForm({ walletpay_tool_id: '', gemini_thinking_budget: 99999 }), boxes, EDIT);

  it('empty ObjectId selects become null, never an empty string', () => {
    expect(built.walletpay_tool_id).toBeNull();
  });

  it('the thinking budget is clamped to the API range', () => {
    expect(built.gemini_thinking_budget).toBe(24576);
  });

  it('the training boxes overwrite the form copies of the three doc fields', () => {
    expect(built.suggestion_text).toBe('general text');
    expect(built.suggestion_company_text).toBe('company text');
    expect(built.suggestion_text_no_profile).toBe('noprofile text');
  });

  it('create forces status 0 while edit keeps the form value', () => {
    expect(buildHookPayload(loadedForm(), boxes, { isCreate: true }).status).toBe(0);
    expect(buildHookPayload(loadedForm({ status: 1 }), boxes, EDIT).status).toBe(1);
  });

  it('blank callback_slip rows are dropped', () => {
    expect(
      buildHookPayload(loadedForm({ callback_slip: ['https://a.test', '  ', ''] }), boxes, EDIT).callback_slip,
    ).toEqual(['https://a.test']);
  });
});

describe('[FEAT-20260817-FORMDIFF] the page normaliser must not resurrect omitted fields', () => {
  it('a field the form did not send is not invented', () => {
    const out = normalizeHookSubmission({ line_oa_name: 'only this' }, EDIT);
    expect(out).toEqual({ line_oa_name: 'only this' });
    // the killer case: a blank training document must NOT be written over the real one
    expect(out).not.toHaveProperty('suggestion_text');
    expect(out).not.toHaveProperty('custom_ai_key');
    expect(out).not.toHaveProperty('telegram_key');
    expect(out).not.toHaveProperty('telegram_chat_id');
  });

  it('a field the form DID send is still normalised', () => {
    expect(normalizeHookSubmission({ custom_ai_key: '  AIzaX  ' }, EDIT).custom_ai_key).toBe('AIzaX');
    expect(normalizeHookSubmission({ telegram_chat_id: '  -1001 ' }, EDIT).telegram_chat_id).toBe('-1001');
  });

  it('a blank telegram_chat_id still clears — it is not a masked field', () => {
    expect(normalizeHookSubmission({ telegram_chat_id: '   ' }, EDIT).telegram_chat_id).toBeNull();
  });

  it('a blank telegram_key is dropped, NOT nulled', () => {
    const out = normalizeHookSubmission({ telegram_key: '   ' }, EDIT);
    expect(out).not.toHaveProperty('telegram_key');
  });

  it('an explicitly undefined member never reaches the body', () => {
    const out = normalizeHookSubmission({ line_oa_name: 'x', telegram_key: undefined }, EDIT);
    expect(Object.keys(out)).toEqual(['line_oa_name']);
  });

  it('create still forces status 0 even when the form omitted status', () => {
    expect(normalizeHookSubmission({ alias: 'a' }, { isCreate: true }).status).toBe(0);
  });
});

describe('[FEAT-20260817-FORMDIFF] sameValue', () => {
  it('treats rebuilt arrays and objects as equal by value', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue(['a'], ['a', 'b'])).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('treats two NaNs as unchanged, so an empty numeric box is not an edit', () => {
    expect(sameValue(Number(undefined), Number(undefined))).toBe(true);
  });

  it('never confuses null, undefined, 0 and empty string', () => {
    expect(sameValue(null, undefined)).toBe(false);
    expect(sameValue(0, null)).toBe(false);
    expect(sameValue('', null)).toBe(false);
    expect(sameValue(0, '')).toBe(false);
    expect(sameValue(false, 0)).toBe(false);
  });

  it('does not treat an array as equal to an object', () => {
    expect(sameValue([], {})).toBe(false);
  });
});

/* [P2-20260813] + [MERGE-20260817] per-hook AI vendor — the p2-only pair.
 *
 * `ai_vendor` / `ai_model` are p2 fields; dev has no per-hook vendor, so when
 * dev lifted `buildHookPayload` out of HookFormModal verbatim the pair did not
 * come with it and had to be re-added by hand during the merge.
 *
 * WHY THE NORMALISATION EXISTS AT ALL, given `...formData` already carries the
 * value: the select's "use the default" option has the value `''`, and the BE
 * rejects `''` as an unknown vendor. It has to reach the API as `null`.
 *
 * WHY THESE TESTS EXIST: after the merge a mutation proved the gap — deleting
 * both normalisation lines from `buildHookPayload` left the whole suite GREEN.
 * The three modal-level cases only cover "operator touched nothing", where the
 * diff omits the pair either way, so they can never see it. The two paths that
 * CAN see it are the two below, and neither had a test.
 * ถอด normalisation ออกแล้วเทสไม่แดง = ยังไม่มีใครคุ้มบรรทัดนั้น จึงเพิ่มสองเคสนี้
 */
describe('[FEAT-20260904-VENDORSECCOL] the DeepSeek pair survives the way out', () => {
  /* ⚠️ THE FAILURE THIS EXISTS FOR (§14 of dev-local, and it has happened here):
     a field can be added to the form, the tab, the BE schema and the BE
     validator, pass every render test — and still die on the way OUT, because
     the request body is built by code that never heard of it. The operator
     types a key, presses save, sees success, reopens the form and it is gone.
     เทสขาเข้าอย่างเดียวไม่พอ ต้องพิสูจน์ว่ามันออกไปถึง API จริง */

  it('⭐ an edited DeepSeek key reaches the request body', () => {
    const out = submit(
      loadedForm({ custom_ai_key_sec: 'sk-deepseek-NEW' }),
      loadedForm(),
    );
    expect(out.custom_ai_key_sec).toBe('sk-deepseek-NEW');
  });

  it('⭐ an UNTOUCHED masked key is omitted — never posted back as the sentinel', () => {
    // Posting `__SECRET_KEPT__` back as a value is how a live key gets
    // overwritten with a placeholder; the diff must simply not carry it.
    const out = submit(loadedForm(), loadedForm());
    expect('custom_ai_key_sec' in out).toBe(false);
  });

  it('the key is trimmed, like every other credential — on BOTH builders', () => {
    /* ⚠️ Two functions, two chances to miss it, and the spread hides the gap:
       `buildHookPayload` starts from `...formData`, so the field ARRIVES even
       with no line naming it — only the trim is lost. A mutation that deleted
       that line survived every case until this half was added (04/09).
       ช่องว่างหน้า-หลังคีย์ = 401 ที่ค่ายปลายทาง อธิบายไม่ได้ */
    expect(
      normalizeHookSubmission({ custom_ai_key_sec: '  sk-x  ' }, EDIT)
        .custom_ai_key_sec,
    ).toBe('sk-x');
    expect(
      buildHookPayload(loadedForm({ custom_ai_key_sec: '  sk-y  ' }), boxes, {
        isCreate: true,
      }).custom_ai_key_sec,
    ).toBe('sk-y');
  });

  it('⭐ the DeepSeek model reaches the body, and blank arrives as null not ""', () => {
    const chosen = buildHookPayload(
      loadedForm({ ai_vendor: 'deepseek', ai_model_sec: 'deepseek-reasoner' }),
      boxes,
      { isCreate: true },
    );
    expect(chosen.ai_model_sec).toBe('deepseek-reasoner');

    const cleared = submit(
      loadedForm({ ai_model_sec: null }),
      loadedForm({ ai_model_sec: 'deepseek-reasoner' }),
    );
    expect('ai_model_sec' in cleared).toBe(true);
    expect(cleared.ai_model_sec).toBeNull();
  });

  it('⭐ editing the DeepSeek key does not touch the Gemini one', () => {
    // The whole point of two columns: they move independently.
    const out = submit(
      loadedForm({ custom_ai_key_sec: 'sk-deepseek-NEW' }),
      loadedForm(),
    );
    expect('custom_ai_key' in out).toBe(false);
  });
});

describe('[P2] ai_vendor / ai_model never reach the API as an empty string', () => {
  it('⭐ CREATE has no baseline and sends everything — "" must arrive as null', () => {
    const body = buildHookPayload(
      loadedForm({ ai_vendor: '', ai_model: '' }),
      boxes,
      { isCreate: true },
    );
    expect(body.ai_vendor).toBeNull();
    expect(body.ai_model).toBeNull();
    // and the value the operator really picked still survives the same path
    const chosen = buildHookPayload(
      loadedForm({ ai_vendor: 'deepseek', ai_model: 'deepseek-reasoner' }),
      boxes,
      { isCreate: true },
    );
    expect(chosen.ai_vendor).toBe('deepseek');
    expect(chosen.ai_model).toBe('deepseek-reasoner');
  });

  it('⭐ clearing a configured vendor on an EDIT is sent as null, not ""', () => {
    const out = submit(
      loadedForm({ ai_vendor: '', ai_model: '' }),
      loadedForm({ ai_vendor: 'deepseek', ai_model: 'deepseek-reasoner' }),
    );
    // it IS sent — clearing must actually clear
    expect('ai_vendor' in out).toBe(true);
    expect(out.ai_vendor).toBeNull();
    expect(out.ai_model).toBeNull();
  });

  it('switching vendor sends the new one and nothing else moves', () => {
    const out = submit(
      loadedForm({ ai_vendor: 'gemini', ai_model: 'gemini-2.0-flash' }),
      loadedForm({ ai_vendor: 'deepseek', ai_model: 'deepseek-reasoner' }),
    );
    expect(Object.keys(out).sort()).toEqual(['ai_model', 'ai_vendor']);
    expect(out.ai_vendor).toBe('gemini');
  });

  it('an untouched vendor is omitted, so the stored one is left alone', () => {
    const out = submit(
      loadedForm({ ai_vendor: 'deepseek', ai_model: 'deepseek-reasoner' }),
      loadedForm({ ai_vendor: 'deepseek', ai_model: 'deepseek-reasoner' }),
    );
    expect('ai_vendor' in out).toBe(false);
    expect('ai_model' in out).toBe(false);
  });
});

describe('[FEAT-20260918-HOOKTRANS] chat translation settings survive the round trip', () => {
  it('buildHookPayload normalizes translate_lang and auto_translate safely', () => {
    const p1 = buildHookPayload(
      loadedForm({ translate_lang: 'zh-Hans', auto_translate: true }),
      boxes,
      { isCreate: false },
    );
    expect(p1.translate_lang).toBe('zh-Hans');
    expect(p1.auto_translate).toBe(true);

    const p2 = buildHookPayload(
      loadedForm({ translate_lang: '', auto_translate: false }),
      boxes,
      { isCreate: false },
    );
    expect(p2.translate_lang).toBeNull();
    expect(p2.auto_translate).toBe(false);
  });

  it('untouched translate settings are omitted on edit', () => {
    const base = loadedForm({ translate_lang: 'th', auto_translate: true });
    const out = submit(base, base);
    expect('translate_lang' in out).toBe(false);
    expect('auto_translate' in out).toBe(false);
  });

  it('updating translate_lang sends only translate_lang', () => {
    const out = submit(
      loadedForm({ translate_lang: 'my', auto_translate: false }),
      loadedForm({ translate_lang: null, auto_translate: false }),
    );
    expect(out).toEqual({ translate_lang: 'my' });
  });

  it('clearing translate_lang sends null so backend clears stored setting', () => {
    const out = submit(
      loadedForm({ translate_lang: '', auto_translate: false }),
      loadedForm({ translate_lang: 'zh-Hans', auto_translate: false }),
    );
    expect(out).toEqual({ translate_lang: null });
  });

  it('toggling auto_translate sends only the boolean toggle', () => {
    const out = submit(
      loadedForm({ translate_lang: 'th', auto_translate: true }),
      loadedForm({ translate_lang: 'th', auto_translate: false }),
    );
    expect(out).toEqual({ auto_translate: true });
  });
});
