import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * [FEAT-20260809-PAYROLES] "can an operator actually BUILD a payment tool?"
 *
 * ══ WHY THIS FILE EXISTS — a real miss, worth not repeating ══════════════════
 * The payment feature shipped with every field name matching the backend, the
 * value contract pinned, tsc clean and every test green — and it was STILL
 * unusable from the dashboard, because the "หน้าที่" (role) dropdown never got
 * the two payment roles. There was no way to mark an endpoint as `pay_topup` or
 * `pay_walletpay`, so a payment tool could only be created by editing Mongo by
 * hand. The owner found it by opening the screen; no test did.
 *
 * The lesson: value-contract tests prove the form SENDS the right shape. They
 * say nothing about whether the control needed to produce that shape EXISTS.
 * เทสต์ค่าที่ส่ง ≠ เทสต์ว่ามีปุ่มให้กด.
 *
 * So this file asserts REACHABILITY: for each thing the backend can consume,
 * is there a control in the UI that can produce it?
 * ════════════════════════════════════════════════════════════════════════════
 */

const src = readFileSync(
  resolve(__dirname, '../pages/hook/CustomTools.tsx'),
  'utf8',
);

// [FEAT-20260809-REACHAUDIT] The hook-side half of the feature. Building a payment tool is
// only half the job — an operator must then BIND it to an OA and switch it on. Those controls
// live in a different file, and until now nothing asserted they exist at all.
const hookSrc = readFileSync(
  resolve(__dirname, '../components/hook/HookFormModal.tsx'),
  'utf8',
);

describe('[PAYROLES] the payment roles are selectable in the UI', () => {
  // The backend finds these two endpoints by ROLE only — never by KEY name — so
  // an operator who cannot pick the role cannot build a working payment tool.
  it.each(['pay_topup', 'pay_walletpay'])(
    'ROLE_OPTIONS offers %s',
    (role) => {
      const options = src.slice(
        src.indexOf('const ROLE_OPTIONS'),
        src.indexOf('];', src.indexOf('const ROLE_OPTIONS')),
      );
      expect(options).toContain(`value: '${role}'`);
    },
  );

  it('every offered role is one the backend accepts', () => {
    // ENDPOINT_ROLES in the backend's custom-tool-normalize.ts. A role NOT on
    // that list is coerced to '' on save — silently, with a 200 response — so
    // offering one here would be a control that appears to work and does not.
    const backendRoles = [
      '', 'profile', 'link', 'edit', 'unlink', 'login', 'refresh',
      'other', 'site_rules', 'pay_topup', 'pay_walletpay',
    ];
    const block = src.slice(
      src.indexOf('const ROLE_OPTIONS'),
      src.indexOf('];', src.indexOf('const ROLE_OPTIONS')),
    );
    const offered = [...block.matchAll(/value: '([^']*)'/g)].map((m) => m[1]);

    expect(offered.length).toBeGreaterThan(0);
    for (const role of offered) expect(backendRoles).toContain(role);
  });
});

// [FEAT-20260809-MINTCONST] the single definition of every minted path
const mintPaths = src.slice(src.indexOf('const MINT_PATHS'), src.indexOf('const MINT_PAY_TOPUP_ENDPOINT'));

describe('[SHOPAPIPAYTEMPLATE] the Shop-API template produces a usable payment tool', () => {
  const tpl = src.slice(
    src.indexOf('const shopapiForm'),
    src.indexOf('// ==== [FEAT-20260801-SHOPAPITEMPLATE] END'),
  );
  // the shared definition the template pulls the topup leg from
  const topupLeg = src.slice(
    src.indexOf('const MINT_PAY_TOPUP_ENDPOINT'),
    src.indexOf('const MINT_PAY_WALLETPAY_ENDPOINT'),
  );

  it('is category payment — topup is a sub-endpoint of the same Shop-API tool', () => {
    expect(tpl).toContain("category: 'payment'");
  });

  it('carries the validate-slip endpoint tagged pay_topup', () => {
    // [FEAT-20260809-MINTCONST] the leg is now the shared MINT_PAY_TOPUP_ENDPOINT() that this
    // template consumes — assert on that definition, and that the template really uses it.
    expect(tpl).toContain('MINT_PAY_TOPUP_ENDPOINT()');
    // the leg points at the shared path const; the literal lives in MINT_PATHS
    expect(topupLeg).toContain('MINT_PATHS.shopapiValidateSlip');
    expect(mintPaths).toContain('shop-api/v1/customer/validate-slip');
    expect(topupLeg).toContain("role: 'pay_topup'");
  });

  it('sends validate-slip as form-data — it must carry the slip IMAGE', () => {
    // json would drop the file part, and the endpoint would reject every call.
    expect(topupLeg).toContain("request_type: 'form-data'");
  });

  it('does NOT put walletpay in this template — it lives on another host', () => {
    // One tool carries one base_url; walletpay is bound separately on the hook.
    expect(tpl).not.toContain('pay_walletpay');
    expect(tpl).not.toContain('payin');
  });
});

describe('[WALLETPAYTEMPLATE] walletpay has its OWN template button', () => {
  // walletpay is a SEPARATE tool: BE builds `base_url + '/' + path` and a tool
  // carries one base_url, but topup and walletpay are on different hosts. Proven
  // the hard way — with them in one tool the walletpay leg posted to the topup
  // host and 404'd every time.
  const tpl = src.slice(
    src.indexOf('const WALLETPAY_BASE_URL'),
    src.indexOf('// ==== [FEAT-20260809-WALLETPAYTEMPLATE] END'),
  );
  // [FEAT-20260809-MINTCONST] host + leg now live in the shared mint block
  const walletpayLeg = src.slice(src.indexOf('const MINT_PAY_WALLETPAY_ENDPOINT'));
  const walletpayHost = src.slice(src.indexOf('const MINT_HOSTS'), src.indexOf('const MINT_PATHS'));

  it('the template exists and is reachable from a button', () => {
    expect(src).toContain('const walletpayForm');
    // A template nobody can click is the exact class of bug this file exists
    // for: the function shipped, the control did not.
    expect(src).toContain('setForm(walletpayForm())');
    expect(src).toContain('ใช้ข้อมูล template (walletpay)');
  });

  it('carries the payin endpoint tagged pay_walletpay, as form-data', () => {
    expect(tpl).toContain('MINT_PAY_WALLETPAY_ENDPOINT()');
    expect(walletpayLeg).toContain('MINT_PATHS.walletpayPayinSlip');
    expect(mintPaths).toContain('payin/{{refId}}/slip');
    expect(walletpayLeg).toContain("role: 'pay_walletpay'");
    // json would drop the slip image and every call would be rejected.
    expect(walletpayLeg).toContain("request_type: 'form-data'");
  });

  it('uses its own host — never the Shop-API one', () => {
    // the template references MINT_HOSTS.walletpay; the literal itself lives in the mint block
    expect(tpl).toContain('MINT_HOSTS.walletpay');
    expect(walletpayHost).toContain('walletpay.example.com');
    // the walletpay template must never reach for the Shop-API host
    expect(tpl).not.toContain('api.example.com');
    expect(tpl).not.toContain('MINT_HOSTS.shopapi');
  });

  it('needs no auth — refId is the only secret in that exchange', () => {
    // auth_type is a property of the TOOL (the template); require_jwt is a property of the
    // LEG, which now lives in the shared mint definition.
    expect(tpl).toContain("auth_type: 'none'");
    expect(walletpayLeg).toContain('require_jwt: false');
  });
});

/**
 * [FEAT-20260809-REACHAUDIT] The hook-side controls — same question, other file.
 *
 * A payment tool that cannot be bound to an OA and switched on is as unusable as one that
 * cannot be built. Each binding needs BOTH halves reachable: a picker to choose the tool and
 * a switch to turn it on, because the backend acts only when both are set.
 * ทดสอบว่า "มีปุ่มให้กด" ไม่ใช่แค่ "ส่งค่าถูก".
 */
describe('[REACHAUDIT] the hook-side payment controls exist', () => {
  it.each([
    // [state key, id key] — the backend needs both, so both need a control
    ['payment_tool_status', 'payment_tool_id'],
    ['walletpay_tool_status', 'walletpay_tool_id'],
  ])('%s has a switch and %s has a picker', (statusKey, idKey) => {
    // a checkbox that writes the flag
    expect(hookSrc).toContain(`${statusKey}: e.target.checked`);
    // a <select> that writes the id, normalising the empty option to null
    expect(hookSrc).toContain(`${idKey}: e.target.value || null`);
  });

  it('the walletpay picker is NOT filtered by category', () => {
    // The backend deliberately does not category-gate the walletpay tool — the category flag
    // guards the money kill switch, which has already passed by the time walletpay is reached.
    // Filtering here would hide valid targets and strand the operator, so this asserts the
    // picker maps the unfiltered list. กรองตรงนี้ = ซ่อน tool ที่ใช้ได้จริง
    const walletpayBlock = hookSrc.slice(hookSrc.indexOf('const walletpayId'));
    const picker = walletpayBlock.slice(0, walletpayBlock.indexOf('</select>'));
    expect(picker).toContain('customToolOptions.map');
    expect(picker).not.toContain("category === 'payment'");
  });

  it('the payment picker IS filtered to category payment', () => {
    // The inverse of the rule above: a non-payment tool in this slot cannot verify a slip.
    expect(hookSrc).toContain("customToolOptions.filter(t => t.category === 'payment')");
  });
});

/**
 * [FEAT-20260809-MINTCONST] The mint constants — one definition per host/path/leg.
 *
 * ⭐ The LEAK GUARD below is the durable half of this. Centralising helps maintenance, but a
 * single block of "default values" is exactly the place someone later pastes a real key to
 * "make the template work out of the box". Everything in this file is compiled into the
 * browser bundle, so any secret placed there is public the moment it ships.
 * ค่าพวกนี้ติดไปกับ bundle ที่ browser โหลด = สาธารณะ
 */
describe('[MINTCONST] the mint block leaks nothing', () => {
  const block = src.slice(
    src.indexOf('// ==== [FEAT-20260809-MINTCONST] START'),
    src.indexOf('// ==== [FEAT-20260809-MINTCONST] END'),
  );

  it('the block exists and is non-trivial', () => {
    // guards against the slice silently returning '' and every assertion below passing vacuously
    expect(block.length).toBeGreaterThan(500);
  });

  it('contains no 32-hex literal (an API key / HMAC secret shape)', () => {
    // 32+ hex chars in a row is what these secrets look like. Anything matching is assumed to
    // be a real credential rather than a coincidence.
    expect(block).not.toMatch(/[0-9a-fA-F]{32,}/);
  });

  it('sets no non-empty api_key / secret / token anywhere', () => {
    // The operator pastes the secret into the form; it must never be a default.
    expect(block).not.toMatch(/api_key\s*:\s*['"`][^'"`]+['"`]/);
    expect(block).not.toMatch(/(secret|token|password)\s*:\s*['"`][^'"`]+['"`]/i);
  });

  it('carries no web_code — it is per-OA and set on the hook, never minted', () => {
    expect(block).not.toMatch(/web_code\s*:\s*['"`][^'"`]+['"`]/);
  });
});

describe('[MINTCONST] the templates still mint the same values', () => {
  // The no-behaviour-change guard: centralising must not have altered any produced value.
  // (Proven exhaustively at refactor time by diffing every template's JSON output before vs
  // after; these assertions keep the key ones pinned going forward.)
  it('the three hosts each have exactly one definition', () => {
    expect(src).toContain("demo: 'https://dev-omnidesk-api.example.com/demo-api'");
    expect(src).toContain("shopapi: 'https://api.example.com'");
    expect(src).toContain("walletpay: 'https://api.walletpay.example.com'");
    // the old per-template literals must be gone, or the drift this block prevents is back
    expect(src.match(/'https:\/\/api\.example\.com'/g) || []).toHaveLength(1);
    expect(src.match(/'https:\/\/api\.walletpay\.example\.com'/g) || []).toHaveLength(1);
  });

  it('the two money legs are defined once each, with their load-bearing fields', () => {
    expect(src).toContain("shopapiValidateSlip: 'shop-api/v1/customer/validate-slip'");
    expect(src).toContain("walletpayPayinSlip: 'api/v1/public/payin/{{refId}}/slip'");
    const topup = src.slice(src.indexOf('const MINT_PAY_TOPUP_ENDPOINT'), src.indexOf('const MINT_PAY_WALLETPAY_ENDPOINT'));
    expect(topup).toContain("role: 'pay_topup'");
    expect(topup).toContain("request_type: 'form-data'");   // must carry the slip IMAGE
    expect(topup).toContain('require_jwt: false');          // HMAC, not JWT
    const walletpay = src.slice(src.indexOf('const MINT_PAY_WALLETPAY_ENDPOINT'));
    expect(walletpay).toContain("role: 'pay_walletpay'");
    expect(walletpay).toContain("request_type: 'form-data'");
  });
});

describe('[REACHAUDIT] the slip require-profile controls exist', () => {
  // Slip-checking policy, deliberately independent of the payment feature: an OA may want
  // this rule with no topup/walletpay configured at all.
  it('the gate has a select bound to slip_require_profile', () => {
    expect(hookSrc).toContain('name="slip_require_profile"');
    expect(hookSrc).toContain("slip_require_profile: e.target.value === 'true'");
  });

  it('the customer message has an input, revealed when the gate is on', () => {
    expect(hookSrc).toContain('name="slip_require_profile_text"');
    // revealed conditionally — the value still submits as '' when unset, which is what
    // tells the backend to use its own Thai default
    expect(hookSrc).toContain('(formData as any).slip_require_profile ?');
  });

  it('the message input advertises the backend default as its placeholder', () => {
    // An operator should see what the customer gets if they leave it blank.
    // ⚠️ If the backend changes REPLY text, this placeholder must follow.
    expect(hookSrc).toContain('placeholder="ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง"');
  });
});

/**
 * [FEAT-20260809-ADDTOPUPLINE] the one-click "add the topup leg" button.
 *
 * An operator with an existing Shop-API tool would otherwise hand-enter validate-slip and get
 * five fields exactly right, `role` above all — the BE matches on it and silently coerces an
 * unknown value to '' on save. A button that produced a MIS-ROLED endpoint would be worse than
 * no button: it looks done and never fires. ปุ่มที่ใส่ role ผิด = พังเงียบ ๆ
 */
describe('[ADDTOPUPLINE] the topup line can be appended in one click', () => {
  // NOTE: these markers sit inside a JSX comment ({/* ... */}), not a // line comment, so
  // match the marker text itself rather than a leading '//'.
  const btn = src.slice(
    src.indexOf('[FEAT-20260809-ADDTOPUPLINE] START'),
    src.indexOf('[FEAT-20260809-ADDTOPUPLINE] END'),
  );

  it('the button exists next to the other endpoint controls', () => {
    expect(btn.length).toBeGreaterThan(200);
    expect(btn).toContain('เส้นเติมเงิน (topup)');
  });

  it('appends rather than replacing — an existing tool keeps its endpoints', () => {
    // the template buttons do setForm(xxxForm()); this one must spread the current list
    expect(btn).toContain('...form.endpoints');
    expect(btn).not.toContain('setForm(shopapiForm())');
  });

  it('mints the line from the SHARED definition, not a retyped literal', () => {
    // one definition shared with shopapiForm() is what stops the two drifting apart
    expect(btn).toContain('MINT_PAY_TOPUP_ENDPOINT()');
  });

  it('the appended line carries role pay_topup and form-data', () => {
    // asserted on the shared definition the button calls — the properties that make the
    // endpoint work at all. If either regresses, the button silently mints a dead leg.
    const leg = src.slice(
      src.indexOf('const MINT_PAY_TOPUP_ENDPOINT'),
      src.indexOf('const MINT_PAY_WALLETPAY_ENDPOINT'),
    );
    expect(leg).toContain("role: 'pay_topup'");
    expect(leg).toContain("request_type: 'form-data'");
  });

  it('refuses a duplicate instead of creating an unsaveable KEY clash', () => {
    // duplicate KEYs fail validateForm, so a second append would just plant an error
    expect(btn).toContain("e.role === 'pay_topup'");
    expect(btn).toContain('setAlert');
  });

  /* [FIX-20260810-TOPUPBTNALWAYS] The button used to render only for `category === 'payment'`.
   * Owner order 2026-08-10: show it for every category — the tool that most needs it is an
   * EXISTING Shop-API tool being extended, and on that tool the button simply was not there.
   * The BE behaviour did not change (it still only reads pay_topup on a payment tool), so the
   * warning replaces the gate: the operator is told, not silently left without the control. */
  it('is no longer gated behind the payment category', () => {
    // ⚠️ Assert on CODE only. The block's comments quote the old gate (explaining what changed)
    // and the revert note spells it out again, so a raw `btn` search matches prose and fails a
    // correct implementation. ตัดคอมเมนต์ออกก่อน ไม่งั้นเทสจับข้อความอธิบาย ไม่ใช่โค้ดจริง
    //
    // ⚠️ `btn` starts AT the marker, which sits INSIDE the opening JSX comment — so the leading
    //    `{/*` was already sliced off and a `/*…*/` pattern has nothing to anchor to. Drop
    //    everything up to the first `*/}` first, then strip any later comments.
    const code = btn
      .slice(btn.indexOf('*/}') + 3)            // the opening comment the marker lives in
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')   // any further JSX + block comments
      .replace(/^\s*\/\/.*$/gm, '');            // line comments
    expect(code).not.toContain("form.category === 'payment' &&");
    expect(code).not.toMatch(/\{\s*form\.category === 'payment'\s*&&/);
  });

  /* [FIX-20260810-CATFROMROLE] REPLACES "warns that the line stays inert until the
     category is payment". That warning existed because the appended line did nothing
     until the operator ALSO switched a separate หมวด dropdown — the line's `role`
     said pay_topup while `category` still said generic, and the runner gates on
     category (payment-runner.service.ts:532). The category is now derived from the
     roles, so the line works on the first save and the warning would be a lie.
     The old test is not deleted quietly: it is replaced by the assertion below,
     which pins the reason it is gone. */
  it('no longer warns about switching หมวด — the line works on save', () => {
    // ⚠️ CODE only, same reason as the test above: the revert note in this block
    // quotes the removed warning verbatim, so a raw `btn` search matches the prose
    // explaining the change and fails a correct implementation.
    // ตัดคอมเมนต์ออกก่อนเสมอ.
    const code = btn
      .slice(btn.indexOf('*/}') + 3)
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain("form.category !== 'payment'");
    // The duplicate-KEY guard also calls setAlert and MUST stay, so assert on the
    // warning's own words rather than on setAlert being absent.
    expect(code).not.toContain('ยังไม่ทำงานจนกว่าจะตั้งหมวด');
    expect(code).not.toContain('อย่าลืมสลับหมวด');
  });

  it('keeps the duplicate-KEY guard (a second PAY_TOPUP would fail validation)', () => {
    // Guarding the regression the assertion above could otherwise invite: stripping
    // every setAlert from this button would silently drop this check too.
    expect(btn).toContain('มีเส้นเติมเงินอยู่แล้ว');
  });

  it('still never writes the category itself — the roles decide it', () => {
    // The click promises ONE endpoint. Writing `category:` here would be a second,
    // hidden effect; the derivation (from `role`) is what flips the tool instead.
    // เพิ่มเส้นอย่างเดียว ห้ามไปตั้งหมวดเองในปุ่มนี้
    expect(btn).not.toContain('category:');
    expect(btn).not.toContain("category: 'payment'");
  });
});
