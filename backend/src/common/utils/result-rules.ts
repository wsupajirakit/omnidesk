export interface ResultRule {
  http_codes?: string;
  path?: string;
  op?: 'exists' | 'not_exists' | 'neq' | 'in' | 'contains' | 'eq';
  value?: unknown;
  action?: 'success' | 'fail';
  failure_type?: string;
  error_code?: string;
  message_path?: string;
}

export interface ResultEvaluationVerdict {
  ok: boolean;
  matched: boolean;
  error_code: string;
  failure_type: string;
  vendor_message: unknown;
}

export interface ResultMapConfig {
  member_id?: string;
  phone?: string;
  name?: string;
}

export interface MappedResult {
  member_id: unknown;
  phone: unknown;
  name: unknown;
}

export function pickByPath(
  obj: unknown,
  path: string | null | undefined,
): unknown {
  if (!obj || !path) return null;
  const res = String(path)
    .split('.')
    .reduce<unknown>((acc, k) => {
      if (acc === null || acc === undefined) return null;
      const next = (acc as Record<string, unknown>)[k];
      return next === undefined ? null : next;
    }, obj);
  return res === undefined ? null : res;
}

export function matchRule(
  rule: ResultRule,
  body: unknown,
  httpStatus: number,
): boolean {
  if (rule.http_codes) {
    const codes = String(rule.http_codes)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (codes.includes(String(httpStatus))) return true;
    if (!rule.path) return false;
  }
  if (!rule.path) return false;

  const actual = pickByPath(body, rule.path);
  let want = '';
  if (typeof rule.value === 'string') {
    want = rule.value;
  } else if (
    typeof rule.value === 'number' ||
    typeof rule.value === 'boolean' ||
    typeof rule.value === 'bigint'
  ) {
    want = String(rule.value);
  } else if (typeof rule.value === 'object' && rule.value !== null) {
    want = JSON.stringify(rule.value);
  }

  let actualStr = '';
  if (typeof actual === 'string') {
    actualStr = actual;
  } else if (
    typeof actual === 'number' ||
    typeof actual === 'boolean' ||
    typeof actual === 'bigint'
  ) {
    actualStr = String(actual);
  } else if (typeof actual === 'object' && actual !== null) {
    actualStr = JSON.stringify(actual);
  }

  switch (rule.op) {
    case 'exists':
      return actual !== null && actual !== undefined;
    case 'not_exists':
      return actual === null || actual === undefined;
    case 'neq':
      return actualStr !== want;
    case 'in':
      return want
        .split(',')
        .map((s) => s.trim())
        .includes(actualStr);
    case 'contains':
      return actualStr.includes(want);
    case 'eq':
    default:
      return actualStr === want;
  }
}

export function evaluateResult(
  rules: ResultRule[] | null | undefined,
  body: unknown,
  httpStatus: number,
): ResultEvaluationVerdict | null {
  const list = Array.isArray(rules) ? rules : [];
  if (!list.length) return null;

  for (const rule of list) {
    if (!matchRule(rule, body, httpStatus)) continue;
    const isSuccess = rule.action === 'success';
    return {
      ok: isSuccess,
      matched: true,
      error_code: isSuccess
        ? 'LINK_OK'
        : rule.error_code || 'LINK_REJECTED_BY_VENDOR',
      failure_type: isSuccess ? '' : rule.failure_type || 'business',
      vendor_message: rule.message_path
        ? pickByPath(body, rule.message_path)
        : null,
    };
  }

  return {
    ok: false,
    matched: false,
    error_code: 'LINK_UNKNOWN',
    failure_type: 'system',
    vendor_message: null,
  };
}

export function mapResult(
  resultMap: ResultMapConfig | null | undefined,
  body: unknown,
): MappedResult | null {
  const m = resultMap || {};
  if (!m.member_id && !m.phone && !m.name) return null;
  return {
    member_id: m.member_id ? pickByPath(body, m.member_id) : null,
    phone: m.phone ? pickByPath(body, m.phone) : null,
    name: m.name ? pickByPath(body, m.name) : null,
  };
}
