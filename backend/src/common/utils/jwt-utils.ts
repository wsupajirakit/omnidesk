import { createHmac, timingSafeEqual } from 'node:crypto';

export function padding(value: string): string {
  const padLength = (4 - (value.length % 4)) % 4;
  return value + '='.repeat(padLength);
}

export function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padding(normalized), 'base64').toString('utf8');
}

export function parseExpiry(value: string | number | undefined | null): number {
  if (typeof value === 'number') return Math.max(1, value);
  if (typeof value === 'string') {
    const match = value.match(/^(\d+)([smhd])$/i);
    if (match && match[1] && match[2]) {
      const num = Number(match[1]);
      const unit = match[2].toLowerCase();
      const multipliers: Record<string, number> = {
        s: 1,
        m: 60,
        h: 3600,
        d: 86400,
      };
      return Math.max(1, num * (multipliers[unit] ?? 1));
    }
  }
  return 3600;
}

export function signToken(
  payload: Record<string, unknown>,
  secret: string,
  expiresIn: string | number = '1h',
): string {
  if (!secret) {
    throw new Error('JWT secret is required');
  }
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const ttl = parseExpiry(expiresIn);
  const body = { ...payload, iat: now, exp: now + ttl };
  const segments = [
    base64UrlEncode(JSON.stringify(header)),
    base64UrlEncode(JSON.stringify(body)),
  ];
  const signature = createHmac('sha256', secret)
    .update(segments.join('.'))
    .digest();
  return `${segments.join('.')}.${base64UrlEncode(signature)}`;
}

export function verifyToken<T = Record<string, unknown>>(
  token: string,
  secret: string,
): T {
  if (!token) {
    throw new Error('Token is required');
  }
  if (!secret) {
    throw new Error('JWT secret is required');
  }
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Malformed token');
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerSegment)) as { alg?: string };
  } catch {
    throw new Error('Malformed token');
  }
  if (header.alg !== 'HS256') {
    throw new Error('Unexpected token algorithm');
  }
  const data = `${headerSegment}.${payloadSegment}`;
  const expected = createHmac('sha256', secret).update(data).digest();
  const expectedSegment = base64UrlEncode(expected);
  const signatureBuffer = Buffer.from(signatureSegment);
  const expectedBuffer = Buffer.from(expectedSegment);
  if (signatureBuffer.length !== expectedBuffer.length) {
    throw new Error('Invalid token signature');
  }
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error('Invalid token signature');
  }
  const payload = JSON.parse(base64UrlDecode(payloadSegment)) as T & {
    exp?: number;
  };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }
  return payload;
}
