import { InternalServerErrorException } from '@nestjs/common';

/**
 * ==== [FIX-20260818-PROBESSRF] Moved here from `modules/external`. audit H14
 *
 * WHY IT MOVED, AND WHY NOT AN EXPORT WHERE IT WAS. A second caller appeared —
 * `POST /config/test-custom` in the system module, a read SSRF that hands the
 * target's status, headers and full body back to the caller. Reaching this
 * function from there would have meant `system` importing `@/modules/external`,
 * and `external` already imports `@/modules/system` in four places
 * (external.module, custom-tool.service, external-api.service,
 * hook-outbound.service). That is a module cycle.
 *
 * `common/utils` is where this species of helper already lives — `escape-regex`,
 * `header-safe-token`, `hmac-signer`, `mask-creds` — and nothing under `common`
 * may depend on a feature module, so the direction is right and both callers
 * share ONE definition. Writing a second guard would have been the drift this
 * codebase has been bitten by repeatedly.
 *
 * The logic below is unchanged from where it lived, including the two comments
 * that record why it looks the way it does.
 */

/**
 * Carried across with the function it serves, rather than swapped for a bare
 * `String(...)`. The legacy handlers call `String(...)` on these body fields
 * directly, INCLUDING the "[object Object]" it yields when a caller posts an
 * object where a string belongs — reproducing that is the point, so a caller
 * that is quietly broken against legacy stays quietly broken here rather than
 * changing shape. Keeping it also keeps this file self-contained: importing the
 * original back out of `modules/external` would rebuild the cycle this move
 * exists to avoid.
 */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  return String(value);
}

/**
 * [SEC-H1] Blocks SSRF to private / loopback / metadata hosts for a URL that
 * arrived in the request body. Ported from hookController.js:244 —
 * hostname-based, so it does not defeat DNS rebinding, but it closes the direct
 * cases that were reachable here.
 *
 * ⚠️ THE STATUS IS 500, NOT 400, AND THAT IS DELIBERATE. Legacy's helper sets
 * `err.statusCode = 400`, but both callers reach it by THROWING, and their
 * catch blocks are `res.status(500).json({ error: error.message })` — the
 * statusCode is never read (hookController.js:3162, 3392). Every other
 * rejection in those two handlers is a `return res.status(...)`, which is why
 * only this one lands on 500. Answering the "correct" 400 here would be a
 * silent contract change for the dashboard, so the legacy pair
 * (500 + legacy's message) is reproduced verbatim.
 *
 * @param field names the body field in the message. It defaults to
 *   `external_api_url` so the original caller's message is byte-identical; the
 *   probe route passes its own so an operator is not told to check a field its
 *   form does not have.
 */
export function assertPublicUrl(
  rawUrl: unknown,
  field = 'external_api_url',
): void {
  if (!rawUrl) return; // no URL = let the original logic fall back to config
  let host: string;
  try {
    host = new URL(str(rawUrl)).hostname.toLowerCase();
  } catch {
    throw new InternalServerErrorException(`invalid ${field}`);
  }

  /**
   * [FIX-20260818-SSRFBRACKET · plan §2.4 B2 = T1-4, closes H13] `URL.hostname`
   * returns an IPv6 literal WITH its brackets — measured, not assumed:
   *   http://[::1]/              → "[::1]"
   *   http://[::ffff:127.0.0.1]/ → "[::ffff:7f00:1]"
   * so the `host === '::1'` comparison below could never match and every IPv6
   * spelling of loopback walked through the guard whose only job was to stop it.
   * Stripping the brackets first is what revives that line.
   */
  const bare =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  const blocked =
    bare === 'localhost' ||
    bare === '::1' ||
    bare === '::' ||
    bare.endsWith('.localhost') ||
    /^127\./.test(bare) ||
    /^10\./.test(bare) ||
    /^192\.168\./.test(bare) ||
    /^169\.254\./.test(bare) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(bare) ||
    bare === '0.0.0.0' ||
    /* Ranges the original list never covered. fe80::/10 is link-local (the IPv6
       twin of 169.254), fc00::/7 is unique-local (the twin of 10/8), and
       100.64/10 is carrier-grade NAT — all reachable from inside a host and none
       of them a legitimate partner endpoint. */
    /^fe[89ab][0-9a-f]:/.test(bare) ||
    /^f[cd][0-9a-f]{2}:/.test(bare) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(bare) ||
    /* IPv4 written inside an IPv6 literal, in either spelling: Node normalises
       ::ffff:127.0.0.1 to ::ffff:7f00:1, so both forms are matched. */
    /^::ffff:(7f|0a|c0a8|a9fe)/.test(bare) ||
    /^::ffff:(127\.|10\.|192\.168\.|169\.254\.)/.test(bare);
  if (blocked) {
    throw new InternalServerErrorException(
      `${field} points to a private/loopback address`,
    );
  }
}
