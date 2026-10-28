import { createHash, createHmac, randomBytes } from 'node:crypto';

export interface HmacConfig {
  algorithm?: string;
  encoding?: 'hex' | 'base64';
  message?: string;
  headers?: Record<string, string>;
  timestamp_unit?: 'seconds' | 'milliseconds';
  canonical_json?: boolean;
  web_code_field?: string;
}

export const HMAC_DEFAULTS: Required<Omit<HmacConfig, 'headers'>> & {
  headers: Record<string, string>;
} = {
  algorithm: 'sha256',
  encoding: 'hex',
  message: '{{web_code}}{{timestamp}}{{payload}}',
  headers: {
    'X-Timestamp': '{{timestamp}}',
    'X-Signature': '{{signature}}',
  },
  timestamp_unit: 'seconds',
  canonical_json: true,
  web_code_field: 'web_code',
};

/**
 * Escapes special characters `<` `>` `&` and U+2028 / U+2029 to match Go's `encoding/json` default escaping.
 */
export function goEscape(json: string): string {
  return json
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Sorts object keys lexicographically at all nested levels.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeysDeep(record[k]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Canonicalizes request body for HMAC signing.
 */
export function canonicalPayload(
  body: unknown,
  contentType = '',
  canonical = true,
): string {
  if (body === undefined || body === null || body === '') return '';

  const isJson = String(contentType).includes('application/json');
  if (!isJson) {
    if (typeof body === 'string') return body;
    if (typeof body === 'object' && body !== null) return JSON.stringify(body);
    if (
      typeof body === 'number' ||
      typeof body === 'boolean' ||
      typeof body === 'bigint'
    ) {
      return String(body);
    }
    return '';
  }

  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (!canonical) return JSON.stringify(parsed);
  return goEscape(JSON.stringify(sortKeysDeep(parsed)));
}

/**
 * Replaces {{name}} template variables in a string.
 */
export function render(
  template: string,
  vars: Record<string, unknown>,
): string {
  return String(template ?? '').replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const val = vars[k];
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val;
    if (
      typeof val === 'number' ||
      typeof val === 'boolean' ||
      typeof val === 'bigint'
    ) {
      return String(val);
    }
    return JSON.stringify(val);
  });
}

export interface BuildSignatureHeadersOptions {
  secret: string;
  webCode?: string;
  body?: unknown;
  contentType?: string;
  method?: string;
  path?: string;
  url?: string;
  extraVars?: Record<string, unknown>;
  config?: HmacConfig;
  now?: number;
  nonce?: string;
}

export interface SignatureHeadersResult {
  headers: Record<string, string>;
  timestamp: string;
  payload: string;
  message: string;
  signature: string;
  nonce: string;
}

/**
 * Builds signature headers for HMAC authentication.
 */
export function buildSignatureHeaders({
  secret,
  webCode,
  body,
  contentType = '',
  method = '',
  path = '',
  url = '',
  extraVars = {},
  config = {},
  now = Date.now(),
  nonce,
}: BuildSignatureHeadersOptions): SignatureHeadersResult {
  const cfg = { ...HMAC_DEFAULTS, ...config };

  const timestamp =
    cfg.timestamp_unit === 'milliseconds'
      ? String(now)
      : String(Math.floor(now / 1000));

  const payload = canonicalPayload(
    body,
    contentType,
    cfg.canonical_json !== false,
  );

  const vars: Record<string, unknown> = {
    ...extraVars,
    web_code: webCode || '',
    timestamp,
    payload,
    payload_sha256: createHash('sha256').update(payload, 'utf8').digest('hex'),
    nonce: nonce || randomBytes(16).toString('hex'),
    method: String(method || '').toUpperCase(),
    path,
    url,
  };

  const message = render(cfg.message || HMAC_DEFAULTS.message, vars);

  const signature = createHmac(cfg.algorithm || 'sha256', String(secret || ''))
    .update(message, 'utf8')
    .digest(cfg.encoding === 'base64' ? 'base64' : 'hex');

  const tplHeaders =
    cfg.headers && Object.keys(cfg.headers).length
      ? cfg.headers
      : HMAC_DEFAULTS.headers;
  const headers: Record<string, string> = {};
  for (const [name, tpl] of Object.entries(tplHeaders)) {
    headers[name] = render(tpl, { ...vars, signature });
  }

  return {
    headers,
    timestamp,
    payload,
    message,
    signature,
    nonce: vars.nonce as string,
  };
}
