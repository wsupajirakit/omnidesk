/**
 * HMAC Signer utility.
 * Ported from legacy hmacSigner.js.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

import { asText } from './as-text';

export interface HmacConfig {
  algorithm?: string;
  encoding?: string;
  message?: string;
  headers?: Record<string, string>;
  timestamp_unit?: string;
  canonical_json?: boolean;
  web_code_field?: string;
}

export const HMAC_DEFAULTS: HmacConfig = {
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

export function goEscape(json: string): string {
  return json
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v: unknown) => sortKeysDeep(v));
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, k: string) => {
        acc[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

export function canonicalPayload(
  body: unknown,
  contentType = '',
  canonical = true,
): string {
  if (body === undefined || body === null || body === '') return '';

  const isJson = String(contentType).includes('application/json');
  if (!isJson) {
    if (typeof body === 'string') return body;
    if (typeof body === 'object') return JSON.stringify(body);
    return asText(body);
  }

  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  if (!canonical) return JSON.stringify(parsed);
  return goEscape(JSON.stringify(sortKeysDeep(parsed)));
}

export function renderTemplate(
  template: string | null | undefined,
  vars: Record<string, unknown>,
): string {
  return String(template == null ? '' : template).replace(
    /\{\{(\w+)\}\}/g,
    (_, k: string) => {
      const val = vars[k];
      if (val === undefined || val === null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return asText(val);
    },
  );
}

export interface SignatureOptions {
  secret: string;
  webCode: string;
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

export interface SignatureResult {
  headers: Record<string, string>;
  timestamp: string;
  payload: string;
  message: string;
  signature: string;
  nonce: string;
}

export function buildSignatureHeaders(opts: SignatureOptions): SignatureResult {
  const cfg = { ...HMAC_DEFAULTS, ...(opts.config || {}) };
  const now = opts.now ?? Date.now();

  const timestamp =
    cfg.timestamp_unit === 'milliseconds'
      ? String(now)
      : String(Math.floor(now / 1000));

  const payload = canonicalPayload(
    opts.body,
    opts.contentType,
    cfg.canonical_json !== false,
  );

  const vars: Record<string, unknown> = {
    ...(opts.extraVars || {}),
    web_code: opts.webCode || '',
    timestamp,
    payload,
    payload_sha256: createHash('sha256').update(payload, 'utf8').digest('hex'),
    nonce: opts.nonce || randomBytes(16).toString('hex'),
    method: String(opts.method || '').toUpperCase(),
    path: opts.path || '',
    url: opts.url || '',
  };

  const message = renderTemplate(cfg.message || HMAC_DEFAULTS.message, vars);

  const signature = createHmac(
    cfg.algorithm || 'sha256',
    String(opts.secret || ''),
  )
    .update(message, 'utf8')
    .digest(cfg.encoding === 'base64' ? 'base64' : 'hex');

  const tplHeaders =
    cfg.headers && Object.keys(cfg.headers).length
      ? cfg.headers
      : HMAC_DEFAULTS.headers || {};
  const headers: Record<string, string> = {};
  for (const [name, tpl] of Object.entries(tplHeaders)) {
    headers[name] = renderTemplate(tpl, { ...vars, signature });
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
