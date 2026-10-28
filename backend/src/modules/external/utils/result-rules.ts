/**
 * Result Rules evaluator utility.
 * Ported from legacy resultRules.js.
 */
import { asText } from './as-text';

export interface ResultRule {
  http_codes?: string;
  path?: string;
  value?: unknown;
  op?: string; // 'eq' | 'neq' | 'in' | 'contains' | 'exists' | 'not_exists'
  action?: string; // 'success' | 'fail'
  error_code?: string;
  failure_type?: string;
  message_path?: string;
}

export interface ResultVerdict {
  ok: boolean;
  matched: boolean;
  error_code: string;
  failure_type: string;
  vendor_message: unknown;
}

export interface ResultMap {
  member_id?: string;
  phone?: string;
  name?: string;
}

export function pickByPath(obj: unknown, path?: string | null): unknown {
  if (!obj || !path || typeof obj !== 'object') return undefined;
  return String(path)
    .split('.')
    .reduce((acc: unknown, k: string) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[k];
    }, obj);
}

function safeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return asText(val);
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
  const want = rule.value == null ? '' : safeString(rule.value);
  const actualStr = safeString(actual);

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
  rules: ResultRule[] | undefined | null,
  body: unknown,
  httpStatus: number,
): ResultVerdict | null {
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
  resultMap: ResultMap | undefined | null,
  body: unknown,
): Record<string, unknown> | null {
  const m = resultMap || {};
  if (!m.member_id && !m.phone && !m.name) return null;
  return {
    member_id: m.member_id ? pickByPath(body, m.member_id) : null,
    phone: m.phone ? pickByPath(body, m.phone) : null,
    name: m.name ? pickByPath(body, m.name) : null,
  };
}
