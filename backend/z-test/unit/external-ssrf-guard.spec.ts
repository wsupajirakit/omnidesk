/**
 * [FIX-20260818-SSRFBRACKET] plan §2.4 B2 = T1-4 of fix_plan_18_aug · closes H13
 *
 * ## The leak, confirmed by running it rather than by reading
 * `new URL('http://[::1]/').hostname` returns `"[::1]"` — WITH the brackets — so
 * the `host === '::1'` line in the denylist could never match. Measured:
 *
 *   http://[::1]/                 → hostname "[::1]"
 *   http://[::ffff:127.0.0.1]/    → hostname "[::ffff:7f00:1]"   (loopback, mapped)
 *   http://localhost/             → hostname "localhost"          (blocked, fine)
 *
 * So every IPv6 spelling of loopback walked straight through a guard whose whole
 * job was to stop it, and the v4-mapped form did too.
 *
 * ## What this pins
 * The BEFORE rows (public URLs) must not move — they are the real use case and a
 * guard that blocks them is worse than the hole. The AFTER rows are the spellings
 * that used to pass and must not any more.
 */
// [FIX-20260818-PROBESSRF] the guard moved to common/utils — one definition,
// now shared with the system module's probe route.
import { assertPublicUrl } from '@/common/utils/assert-public-url';

const BLOCKED = [
  // these already worked — they must keep working
  'http://localhost/x',
  'http://sub.localhost/x',
  'http://127.0.0.1/x',
  'http://10.0.0.5/x',
  'http://192.168.1.1/x',
  'http://169.254.169.254/latest/meta-data/', // cloud metadata
  'http://172.16.0.1/x',
  'http://0.0.0.0/x',
  // ⭐ these are the ones that used to sail through
  'http://[::1]/x',
  'http://[::ffff:127.0.0.1]/x',
  'http://[fe80::1]/x', // link-local
  'http://[fc00::1]/x', // unique-local
  'http://100.64.0.1/x', // carrier-grade NAT
];

const ALLOWED = [
  'https://api.example.com/v1/profile',
  'https://partner.co.th/customer',
  'http://203.0.113.10/x',
  'https://172.32.0.1/x', // just outside the 172.16/12 private block
];

describe('[SSRFBRACKET] the outbound guard blocks internal destinations', () => {
  it.each(BLOCKED)('⭐ %s is refused', (url) => {
    expect(() => assertPublicUrl(url)).toThrow();
  });

  it.each(ALLOWED)(
    '%s still passes — the real use case must not move',
    (url) => {
      expect(() => assertPublicUrl(url)).not.toThrow();
    },
  );

  it('an absent url falls through, unchanged (config decides instead)', () => {
    expect(() => assertPublicUrl(undefined)).not.toThrow();
    expect(() => assertPublicUrl('')).not.toThrow();
  });

  it('a malformed url is refused rather than passed through', () => {
    expect(() => assertPublicUrl('not a url')).toThrow();
  });
});
