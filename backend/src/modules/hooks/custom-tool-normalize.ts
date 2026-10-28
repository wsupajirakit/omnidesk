/**
 * Input normalisers for custom tools.
 *
 * Ported verbatim in behaviour from
 * legacy-api/src/controllers/hook/customToolController.js (`normalizeEndpoints`
 * and `sanitizeHmac`).
 *
 * ⚠️ THESE ARE WHITELISTS. A field not named here is dropped silently on save,
 * with no error anywhere. That has bitten this code three separate times —
 * `is_profile`/`profile_map` ([FIX-20260729-PROFILEFLAG]), `role`/`result_rules`
 * ([FEAT-20260729-EPROLE]) and `idempotency` ([FEAT-20260730-IDEMPOTENT]) each
 * shipped in the schema, were left out here, and vanished on the first save.
 * The symptom is a checkbox that will not stay ticked; the cause is invisible.
 * Adding a field to the schema means adding it here in the same change.
 *
 * ⚠️ Two schema fields legacy does NOT whitelist are deliberately still absent:
 * `endpoints[].cache_ttl_sec` and `endpoints[].profile_map.tier`. They exist on
 * the model and are set by seed scripts, but this handler drops them, so
 * writing them here would be a behaviour change rather than a port. See the
 * report and check-list.md.
 */

import { toScalarString } from './coerce';

/** Signing-recipe keys accepted from a client, `sanitizeHmac` in legacy. */
const HMAC_KEYS = [
  'algorithm',
  'encoding',
  'message',
  'timestamp_unit',
  'web_code_field',
] as const;

export interface HmacInput {
  algorithm?: string;
  encoding?: string;
  message?: string;
  timestamp_unit?: string;
  web_code_field?: string;
  headers?: Record<string, string>;
  canonical_json?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Keeps only the recipe fields the signer understands.
 *
 * `hmac` is a Mixed column, so without this a client could push arbitrary keys
 * into it and grow the document unnoticed. An empty result returns `undefined`,
 * which means "unset" — the signer then uses its own defaults.
 */
export function sanitizeHmac(raw: unknown): HmacInput | undefined {
  if (!isRecord(raw)) return undefined;

  const out: Record<string, unknown> = {};
  for (const key of HMAC_KEYS) {
    const value = raw[key];
    if (value !== undefined && value !== null) out[key] = toScalarString(value);
  }

  // `headers` is a map of templates; accept only string→string pairs.
  const headers = raw['headers'];
  if (isRecord(headers)) {
    const cleaned: Record<string, string> = {};
    for (const [name, template] of Object.entries(headers)) {
      if (name && typeof template === 'string')
        cleaned[String(name)] = template;
    }
    if (Object.keys(cleaned).length > 0) out['headers'] = cleaned;
  }

  if (typeof raw['canonical_json'] === 'boolean') {
    out['canonical_json'] = raw['canonical_json'];
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The object Mongoose materialises for an unset `hmac`, spelled out.
 *
 * ⚠️ Why this exists rather than relying on schema defaults: legacy declares
 * `hmac` as an INLINE nested path (customToolModel.js:367-378), and Mongoose
 * materialises such a path with its defaults on every new document — so legacy
 * always answers with this object even when the caller sent no `hmac` at all.
 *
 * Reproducing that in Nest is not simply a matter of `@Prop(raw({...}))`.
 * `raw()` fixes the *shape* (V4 — a sub-schema would stay `undefined`), but a
 * nested path with no required leaf is still not materialised on create, so the
 * key was absent from the response. The golden diff caught it as
 * `missing: data.hmac`: the dashboard reads `hmac.algorithm` when rendering the
 * signing tab, and would have thrown on every newly created tool.
 *
 * Every value here is the schema's declared default, so this changes nothing
 * about what is stored — it only ensures the object exists.
 */
export const HMAC_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  algorithm: '',
  encoding: '',
  message: '',
  headers: null,
  timestamp_unit: '',
  canonical_json: null,
  web_code_field: '',
});

const PURPOSES = ['auth', 'data', 'write'];
const REQUEST_TYPES = ['json', 'form', 'form-data'];
const RESULT_OPS = ['eq', 'neq', 'in', 'exists', 'not_exists', 'contains'];
const FAILURE_TYPES = ['business', 'config', 'transient', 'system'];
/** `site_rules` is absent because the legacy whitelist omits it — see header. */
/**
 * [FIX-20260810-CATFROMROLE] The roles that make a tool a payment tool.
 *
 * SINGLE SOURCE OF TRUTH for "which roles touch money", shared by the endpoint
 * whitelist below and `deriveCategory`. A third payment leg added here is picked
 * up by both without touching either. revert: inline these two names back into
 * ENDPOINT_ROLES and delete deriveCategory.
 */
export const PAYMENT_ROLES = ['pay_topup', 'pay_walletpay'] as const;

const ENDPOINT_ROLES = [
  'profile',
  'link',
  'edit',
  'unlink',
  'login',
  'refresh',
  'other',
  // [FEAT-20260808-PAYTOOL-P1] payment legs. Without these two in the runtime
  // whitelist, `normalizeEndpoints` coerces the role to '' on save (the exact
  // silent-drop trap this file warns about at :8-14). revert: drop these two.
  ...PAYMENT_ROLES,
];

/**
 * [FEAT-20260808-PAYTOOL-P1] Allowed tool-level categories (config-driven, no
 * hardcoded topup/walletpay names). Single source of truth, imported by the
 * validator so schema/normalize/validate agree.
 * revert: delete TOOL_CATEGORIES + normalizeCategory and their imports.
 */
/* [FEAT-20260815-WALLETPAYCAT] `'walletpay'` joins the list.
   A tool whose only payment leg is `pay_walletpay` is a DIFFERENT job from one that
   runs topup, and an OA needs both at once — Shop-API v1 on `payment_tool_id`,
   walletpay on `walletpay_tool_id`. While both answered `'payment'` the Custom Tools
   page could only offer one link field, so linking the second tool overwrote the
   first and the OA lost its binding (reported live 15/08: "perm มันหายจริง").
   revert: drop 'walletpay' here, from the schema enum, and from `deriveCategory`. */
export const TOOL_CATEGORIES = ['generic', 'payment', 'walletpay'] as const;

/**
 * [FEAT-20260808-PAYTOOL-P1] Whitelists the tool-level `category` on the write
 * path, exactly as `normalizeEndpoints`/`sanitizeHmac` whitelist their fields.
 * An unknown/absent value coerces to `'generic'`, so an existing tool (no
 * category, or any junk) round-trips to today's behaviour byte-identically.
 * revert: delete this function.
 */
export function normalizeCategory(raw: unknown): string {
  const value = str(raw);
  return (TOOL_CATEGORIES as readonly string[]).includes(value)
    ? value
    : 'generic';
}

/**
 * ==== [FIX-20260810-CATFROMROLE] category is DERIVED from the endpoint roles ====
 *
 * WHAT: a tool carrying a `pay_topup` or `pay_walletpay` endpoint is `'payment'`;
 *       anything else is `'generic'`. The stored field keeps its meaning and its
 *       place — only the way the value is decided changes.
 * WHY:  the role dropdown offers `pay_topup`/`pay_walletpay` on EVERY tool, but the
 *       payment runner gates on `category` (`payment-runner.service.ts:532`).
 *       An operator could therefore pick the payment role, save, and get a line
 *       that is silently inert because the separate "หมวด" select still said
 *       generic — no error, no warning. Two fields, one fact, free to disagree.
 *       เจ้าของสั่ง: เลือกหน้าที่ KEY ที่เดียว ไม่ต้องสลับหมวดอีกขั้น.
 * ⚠️ This does NOT remove the money kill switch. `resolvePaymentTool` still
 *    refuses a non-payment tool; the derived value simply cannot contradict the
 *    endpoints the runner will actually look for with `findRole`.
 * ⚠️ Roles come from PAYMENT_ROLES — do not hardcode the two names here, or a
 *    future third payment role would be silently left out.
 * revert: delete this function and pass `normalizeCategory(body.category)`
 *    straight through at both call sites in custom-tools.service.
 */
export function deriveCategory(
  // Structural on purpose: `role` is all this reads, so a NormalizedEndpoint, a
  // stored CustomToolEndpoint and a raw request object all satisfy it.
  endpoints: ReadonlyArray<{ role?: unknown; status?: unknown }>,
): string {
  // A disabled line still decides the category: switching an endpoint off is
  // temporary, and flipping the tool back to 'generic' would ALSO unbind it
  // from every OA (hooks.service.ts:2625) — a far larger effect than the
  // operator asked for.
  const roles = (endpoints || [])
    .filter((e) => !!e)
    .map((e) => str(e.role))
    .filter((r) => (PAYMENT_ROLES as readonly string[]).includes(r));

  if (roles.length === 0) return 'generic';

  /* [FEAT-20260815-WALLETPAYCAT] TOPUP DECIDES. A tool that runs topup is
     `'payment'`, because that is the flag `resolvePaymentTool` gates the money
     path on (`payment-runner.service.ts:614`) — answering anything else for such
     a tool would silently disable every top-up.

     Only when topup is ABSENT does the walletpay leg name the tool. That keeps two
     shapes working at once:
       · the historical single tool carrying BOTH legs  → still 'payment'
       · a dedicated walletpay tool on its own host         → 'walletpay'
     The second is what lets one OA hold Shop-API v1 (`payment_tool_id`) and walletpay
     (`walletpay_tool_id`) at the same time instead of one overwriting the other.

     ⚠️ Read from PAYMENT_ROLES, never hardcode a third role name here. */
  return roles.includes('pay_topup') ? 'payment' : 'walletpay';
}

/**
 * [FEAT-20260808-PAYTOOL-P2] SINGLE SOURCE OF TRUTH for the non-empty payment
 * knob defaults, shared by `normalizePayment` (write path, here) and the payment
 * runner's `readCfg` (read path). Before this constant the two duplicated the
 * table, so a default change had to touch both or the stored vs runtime defaults
 * would drift. `statement_status` is intentionally NOT here: '' is a meaningful
 * value (filter off), so its default only applies when the KEY is absent, which
 * both sites handle explicitly. revert: inline back into normalizePayment.
 */
/* 📍 [DOC-20260810-PAYSTATES] The `*_reply_text` knobs below are the PER-TOOL
 * overrides for the customer-facing copy. Which state each one overrides, and
 * which are shared (e.g. `reply_success_text` covers BOTH success states, and
 * `review_reply_text` currently covers `member_not_match` too), is mapped in
 * `docs/payment-states.md` (LOCAL ONLY, not pushed: `.gitignore:46` ignores
 * `*.md` repo-wide by policy). แก้ข้อความราย tool ที่นี่ · แผนที่ที่ docs. */
export const PAYMENT_KNOB_DEFAULTS = {
  statement_tx_path: 'data.profile.transaction',
  statement_provider_code: 'walletpay',
  statement_status: 'waiting-deposit',
  walletpay_ref_id_field: 'ref_id',
  walletpay_ref_id_query_param: 'refid',
  walletpay_file_field: 'slip',
  topup_payload_path: '',
  /* [NOTE-20260902-SLIPPROVIDERNOTHERE] ⚠️ THE SLIP PROVIDER DOES NOT BELONG HERE.
     It was added to this table on 02/09 and removed the same day. A payment-tool
     knob is unreachable exactly when payment is switched OFF — and slip
     verification runs for payment-off hooks, which is most of them (the whole
     slip test net uses hooks with no payment binding, and there are CLI tools
     that exist because live hooks have none either). A walletpay-only tool cannot
     reach it at all, because `resolvePaymentTool` demands `category:'payment'`.
     It now lives on the HOOK, beside `slip_verify_key` — the credential it
     authenticates with — so the name and the key cannot disagree.
     revert of the revert: don't. See `docs/slip-spec.md` §5.1. */
} as const;

/**
 * [FEAT-20260808-PAYTOOL-P2] Whitelist the revisable payment knobs, exactly as
 * `normalizeEndpoints`/`sanitizeHmac` whitelist theirs — a schema `payment`
 * field NOT whitelisted here is silently dropped on save (the trap this file
 * warns about at :8-14).
 *
 * Returns `undefined` when there is nothing to store, so a GENERIC tool keeps no
 * `payment` key at all (byte-identical). Every recognised key is coerced to a
 * safe scalar/object and defaulted, so the stored block is always complete and
 * the runner never has to guard a half-written config. NO hardcoded topup/walletpay
 * op-name branching — just a fixed set of revisable string/map knobs.
 * revert: delete this function + its create/update wiring.
 */
export function normalizePayment(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const map = isRecord(raw['topup_to_walletpay_map'])
    ? raw['topup_to_walletpay_map']
    : {};
  return {
    statement_tx_path:
      trimmed(raw['statement_tx_path']) ||
      PAYMENT_KNOB_DEFAULTS.statement_tx_path,
    statement_provider_code:
      trimmed(raw['statement_provider_code']) ||
      PAYMENT_KNOB_DEFAULTS.statement_provider_code,
    // '' is a meaningful value here (filter off), so only default when absent.
    statement_status:
      raw['statement_status'] === undefined
        ? PAYMENT_KNOB_DEFAULTS.statement_status
        : str(raw['statement_status']),
    walletpay_ref_id_field:
      trimmed(raw['walletpay_ref_id_field']) ||
      PAYMENT_KNOB_DEFAULTS.walletpay_ref_id_field,
    walletpay_ref_id_query_param:
      trimmed(raw['walletpay_ref_id_query_param']) ||
      PAYMENT_KNOB_DEFAULTS.walletpay_ref_id_query_param,
    walletpay_file_field:
      trimmed(raw['walletpay_file_field']) ||
      PAYMENT_KNOB_DEFAULTS.walletpay_file_field,
    topup_to_walletpay_map: map,
    // [FEAT-20260808-PAYTOOL-P2C] reply-per-state override texts. Each is stored
    // empty when absent; the runner supplies a sensible Thai default per state at
    // reply time (REPLY_STATE_DEFAULTS), so text is editable later WITHOUT code.
    // process-wallet(success) + walletpay-success share reply_success_text;
    // MATCHED_PENDING = pending_reply_text; the review flex = review_reply_text;
    // statement-not-found = not_found_reply_text. revert: drop these 5 lines.
    // [P2C-2c] no_match_reply_text — walletpay answered no_match on this statement
    // and more remain; the customer is asked to tap [ลองใหม่] to try the next
    // one. Additive: absent ⇒ '' ⇒ the runner's default text, so existing tools
    // are unaffected.
    reply_success_text: str(raw['reply_success_text']),
    pending_reply_text: str(raw['pending_reply_text']),
    review_reply_text: str(raw['review_reply_text']),
    not_found_reply_text: str(raw['not_found_reply_text']),
    no_match_reply_text: str(raw['no_match_reply_text']),
    // [NOTLINKED] additive: absent ⇒ '' ⇒ runner default.
    not_linked_reply_text: str(raw['not_linked_reply_text']),
    // [FEAT-20260808-PAYTOOL-P2B] optional DETAIL text for the "mint" button in
    // the payment reply (the description, NOT the button label). Stored empty
    // when absent; the runner falls back to "-" at read time so a tool without
    // it works seamlessly. revert: drop this line.
    reply_detail: str(raw['reply_detail']),
    // [FEAT-20260808-PAYTOOL-P2] dot-path into the slip's Swiftcheck verify result
    // feeding the topup `payload` field; '' = the whole Swiftcheck result.
    topup_payload_path: trimmed(raw['topup_payload_path']),
  };
}

const str = (value: unknown): string =>
  value === undefined || value === null ? '' : toScalarString(value);
const trimmed = (value: unknown): string => str(value).trim();

export interface NormalizedResultRule {
  path: string;
  op: string;
  value: string;
  http_codes: string;
  action: string;
  failure_type: string;
  error_code: string;
  message_path: string;
}

export interface NormalizedEndpoint {
  _id?: unknown;
  key: string;
  label: string;
  purpose: string;
  method: string;
  path: string;
  /** [FEAT-20260903-TOPUPPERPROVIDER] `''` = serves every slip provider. */
  slip_provider: string;
  require_jwt: boolean;
  is_login: boolean;
  is_refresh: boolean;
  is_profile: boolean;
  profile_map: { name: string; phone: string; code: string };
  request_type: string;
  payload: Record<string, unknown>;
  token_path: string;
  refresh_token_path: string;
  status: boolean;
  role: string;
  result_rules: NormalizedResultRule[];
  result_map: { member_id: string; phone: string; name: string };
  idempotency: {
    enabled: boolean;
    location: string;
    field: string;
    retry_on_timeout: number;
  };
}

function normalizeResultRules(raw: unknown): NormalizedResultRule[] {
  if (!Array.isArray(raw)) return [];
  return (
    raw
      .filter(isRecord)
      .map((rule) => ({
        path: trimmed(rule['path']),
        op: RESULT_OPS.includes(str(rule['op'])) ? str(rule['op']) : 'eq',
        value: rule['value'] == null ? '' : toScalarString(rule['value']),
        http_codes: trimmed(rule['http_codes']),
        action: rule['action'] === 'success' ? 'success' : 'fail',
        failure_type: FAILURE_TYPES.includes(str(rule['failure_type']))
          ? str(rule['failure_type'])
          : '',
        error_code: trimmed(rule['error_code']),
        message_path: trimmed(rule['message_path']),
      }))
      // A rule with neither a body path nor an HTTP code can never match — it
      // would sit in the database forever doing nothing.
      .filter((rule) => rule.path !== '' || rule.http_codes !== '')
  );
}

export function normalizeEndpoints(raw: unknown): NormalizedEndpoint[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((entry): NormalizedEndpoint => {
    const endpoint = isRecord(entry) ? entry : {};
    const profileMap = isRecord(endpoint['profile_map'])
      ? endpoint['profile_map']
      : {};
    const resultMap = isRecord(endpoint['result_map'])
      ? endpoint['result_map']
      : {};
    const idempotency = isRecord(endpoint['idempotency'])
      ? endpoint['idempotency']
      : {};

    const normalized: NormalizedEndpoint = {
      key: trimmed(endpoint['key']).toUpperCase(),
      label: str(endpoint['label'] ?? ''),
      purpose: PURPOSES.includes(str(endpoint['purpose']))
        ? str(endpoint['purpose'])
        : 'data',
      method: (endpoint['method'] === undefined || endpoint['method'] === null
        ? 'GET'
        : toScalarString(endpoint['method'])
      ).toUpperCase(),
      path: trimmed(endpoint['path']),
      /* [FEAT-20260903-TOPUPPERPROVIDER] which slip provider this record serves;
         '' = every provider, which is what keeps Swiftcheck working unconfigured.
         Omit this line and an admin's choice is dropped on save with a 200 back,
         so the record silently keeps serving everybody. Lower-cased to match the
         slip row's stamp — the same normalisation `resolveSlipProvider` applies. */
      slip_provider: trimmed(endpoint['slip_provider']).toLowerCase(),
      // Note the polarity: anything other than an explicit `false` means true.
      require_jwt: endpoint['require_jwt'] !== false,
      is_login: endpoint['is_login'] === true,
      is_refresh: endpoint['is_refresh'] === true,
      is_profile: endpoint['is_profile'] === true,
      profile_map: {
        name: trimmed(profileMap['name']),
        phone: trimmed(profileMap['phone']),
        code: trimmed(profileMap['code']),
      },
      request_type: REQUEST_TYPES.includes(str(endpoint['request_type']))
        ? str(endpoint['request_type'])
        : 'json',
      payload: isRecord(endpoint['payload']) ? endpoint['payload'] : {},
      token_path: endpoint['token_path']
        ? toScalarString(endpoint['token_path'])
        : 'data.access_token',
      refresh_token_path: endpoint['refresh_token_path']
        ? toScalarString(endpoint['refresh_token_path'])
        : 'data.refresh_token',
      status: endpoint['status'] !== false,
      role: ENDPOINT_ROLES.includes(str(endpoint['role']))
        ? str(endpoint['role'])
        : '',
      result_rules: normalizeResultRules(endpoint['result_rules']),
      result_map: {
        member_id: trimmed(resultMap['member_id']),
        phone: trimmed(resultMap['phone']),
        name: trimmed(resultMap['name']),
      },
      idempotency: {
        enabled: idempotency['enabled'] === true,
        location: idempotency['location'] === 'body' ? 'body' : 'header',
        field: trimmed(idempotency['field']) || 'Idempotency-Key',
        // Clamped to 0-3: retrying more than that only loads the upstream.
        retry_on_timeout: Math.max(
          0,
          Math.min(3, Number(idempotency['retry_on_timeout']) || 0),
        ),
      },
    };

    // `_id` is echoed back only when the client sent one, so an edit updates
    // the existing subdocument instead of replacing it with a new row.
    if (endpoint['_id']) normalized._id = endpoint['_id'];
    return normalized;
  });
}
