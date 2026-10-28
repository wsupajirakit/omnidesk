const CRED_KEY =
  /(secret|password|passwd|token|signature|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|web[_-]?code|bearer|authorization|x[-_]?sign)/i;
const ID_KEY = /(^_?id$|_id$)/i;
const OBJECTID = /^[a-f0-9]{24}$/i;

/**
 * Mask a string keeping ~20% of the head. e.g. "sk_live_abcd1234" → "sk_l••••••••••••".
 */
export function maskString(s: unknown): string {
  let str = '';
  if (typeof s === 'string') {
    str = s;
  } else if (
    typeof s === 'number' ||
    typeof s === 'boolean' ||
    typeof s === 'bigint'
  ) {
    str = String(s);
  } else if (typeof s === 'object' && s !== null) {
    str = JSON.stringify(s);
  }
  if (str.length <= 4) return '•'.repeat(str.length);
  const keep = Math.max(2, Math.ceil(str.length * 0.2));
  return str.slice(0, keep) + '•'.repeat(Math.min(str.length - keep, 40));
}

function walk(value: unknown, keyName: string): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => walk(v, keyName));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, k);
    }
    return out;
  }
  if (typeof value === 'string' && keyName && CRED_KEY.test(keyName)) {
    if (ID_KEY.test(keyName) || OBJECTID.test(value)) return value;
    return maskString(value);
  }
  return value;
}

/**
 * Deep masks credential values in a payload.
 */
export function maskCredsDeep<T>(obj: T): T {
  try {
    return walk(obj, '') as T;
  } catch {
    return obj;
  }
}
