import type { CookieOptions, Response } from 'express';

/**
 * [FEAT-20260808-HTTPONLY-S1] Auth cookie helpers.
 *
 * ADDITIVE HttpOnly cookie carrying the JWT. Set on login/refresh alongside the
 * body token + X-Auth-Key header, cleared on logout. Bearer clients are
 * unaffected — this is one more place the same token lives, not a replacement.
 *
 * DB-EFFECT: none. A cookie is client-side state; nothing is written to Mongo.
 */

/**
 * Cookie name. The dashboard reads the session from the response body today, so
 * the name only has to be stable between this backend and omnidesk-ws' future
 * cookie reader — kept simple and channel-neutral.
 */
export const ACCESS_TOKEN_COOKIE = 'access_token';

/** Per-environment cookie attributes resolved from config. */
export interface CookieAttributes {
  /** Empty ⇒ host-only (local); e.g. `.example.com` to share across subdomains. */
  domain?: string;
  /** HTTPS-only. true off local; false only for local http. */
  secure: boolean;
  /** Cross-site policy. `lax` for the same-site *.example.com deploy. */
  sameSite: 'lax' | 'strict' | 'none';
}

/**
 * Builds the express cookie options shared by set + clear, so the clear on
 * logout matches the set exactly (domain/path/sameSite must line up or the
 * browser keeps the old cookie).
 *
 * `httpOnly` is always on: the whole point of the migration is that JavaScript
 * cannot read the token, so an XSS payload cannot exfiltrate it.
 */
export function buildCookieOptions(attrs: CookieAttributes): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: attrs.secure,
    sameSite: attrs.sameSite,
    path: '/',
  };
  // Omit `domain` entirely when empty: passing an empty string makes some
  // clients scope the cookie to the literal empty host instead of host-only.
  if (attrs.domain && attrs.domain.trim() !== '') {
    options.domain = attrs.domain.trim();
  }
  return options;
}

/**
 * Sets the auth cookie. `maxAgeMs` comes from the JWT expiry so the cookie and
 * the token die together — a cookie outliving its token would just yield 401s.
 */
export function setAuthCookie(
  response: Response,
  token: string,
  attrs: CookieAttributes,
  maxAgeMs: number,
): void {
  response.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...buildCookieOptions(attrs),
    maxAge: maxAgeMs,
  });
}

/** Clears the auth cookie on logout. Same attributes as the set, minus maxAge. */
export function clearAuthCookie(
  response: Response,
  attrs: CookieAttributes,
): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE, buildCookieOptions(attrs));
}
