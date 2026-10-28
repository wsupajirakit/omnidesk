import { shouldBlockUnlinkedSlip } from '@/modules/webhook/slip-flex/require-profile.gate';

/**
 * [FEAT-20260809-REQUIREPROFILE] the "no account ⇒ do not verify the slip" gate.
 *
 * THE POINT OF THIS FILE: the gate is trivial to write and easy to get
 * catastrophically wrong. Blocking too eagerly means that during a five-minute
 * upstream outage EVERY customer is told they have no account and NOT ONE slip
 * is verified — far worse than the wasted Swiftcheck call the gate exists to
 * prevent. So most of these tests assert that it does NOT block.
 * ไม่ชัด = ต้องปล่อยผ่าน.
 */

const ON = { slip_require_profile: true };
const notFound = { status: 404, success: false };

describe('[REQUIREPROFILE] blocks ONLY on an explicit "not found"', () => {
  it('blocks when the flag is on and the upstream said 404', () => {
    expect(shouldBlockUnlinkedSlip(ON, { profileBlock: notFound })).toBe(true);
  });

  it('accepts a numeric-string status, since adapters differ', () => {
    expect(
      shouldBlockUnlinkedSlip(ON, {
        profileBlock: { status: '404', success: false },
      }),
    ).toBe(true);
  });
});

describe('[REQUIREPROFILE] ⭐ FAILS OPEN — every uncertainty verifies the slip', () => {
  // Each case below is a way the profile can come back empty WITHOUT meaning
  // "this person has no account". Treating any of them as a verdict is the
  // outage-amplifying bug this gate must never have.
  const cases: Array<[string, Parameters<typeof shouldBlockUnlinkedSlip>[1]]> =
    [
      [
        'circuit breaker open — we learned nothing',
        {
          profileBlock: notFound,
          circuitOpen: true,
        },
      ],
      ['upstream 500', { profileBlock: { status: 500, success: false } }],
      ['upstream 502', { profileBlock: { status: 502, success: false } }],
      [
        '401 — the tool token is wrong',
        { profileBlock: { status: 401, success: false } },
      ],
      [
        '403 — the tool token is wrong',
        { profileBlock: { status: 403, success: false } },
      ],
      [
        'no status at all (timeout / empty body)',
        { profileBlock: { success: false } },
      ],
      [
        'no profile block — misconfigured or dead upstream',
        { profileBlock: null },
      ],
      ['profile fetch never ran', {}],
      ['block is not an object', { profileBlock: 'nope' as never }],
    ];

  it.each(cases)('does NOT block: %s', (_label, probe) => {
    expect(shouldBlockUnlinkedSlip(ON, probe)).toBe(false);
  });

  it('does NOT block a customer who EXISTS, even on a 404-looking body', () => {
    // success:true wins — the customer was found.
    expect(
      shouldBlockUnlinkedSlip(ON, {
        profileBlock: { status: 404, success: true },
      }),
    ).toBe(false);
  });
});

describe('[REQUIREPROFILE] OFF by default — existing OAs are untouched', () => {
  it('does nothing when the flag is absent (every pre-existing hook)', () => {
    expect(shouldBlockUnlinkedSlip({}, { profileBlock: notFound })).toBe(false);
  });

  it('does nothing when the flag is explicitly false', () => {
    expect(
      shouldBlockUnlinkedSlip(
        { slip_require_profile: false },
        {
          profileBlock: notFound,
        },
      ),
    ).toBe(false);
  });

  it('does nothing for a null/undefined hook', () => {
    expect(shouldBlockUnlinkedSlip(null, { profileBlock: notFound })).toBe(
      false,
    );
    expect(shouldBlockUnlinkedSlip(undefined, { profileBlock: notFound })).toBe(
      false,
    );
  });

  it('⭐ junk in the flag can never switch a customer-facing rule ON', () => {
    // The string 'false' is TRUTHY in JS — a loose check would enable the gate
    // here and start refusing slips. `=== true` is what stops that.
    for (const junk of ['false', 'true', 1, 0, {}, [], 'yes']) {
      expect(
        shouldBlockUnlinkedSlip(
          { slip_require_profile: junk },
          {
            profileBlock: notFound,
          },
        ),
      ).toBe(false);
    }
  });
});

describe('[SECRETS] no credential may be committed', () => {
  /**
   * OWNER RULE 2026-08-09: never commit a key — real OR demo — in code or in
   * .md. A demo key still tends to be a working key somewhere, and git history
   * is permanent: once pushed, rotating the key at the server is the only real
   * remedy. ห้าม push ไฟล์ที่มีคีย์ ถึงจะเป็น demo ก็ตาม.
   *
   * This scans the payment sources that legitimately talk about secrets. It
   * catches the shape (a bare 32-char hex literal), not one specific value, so
   * it also fails for the NEXT key somebody pastes in.
   */
  const files = [
    'src/modules/payment/validate-slip-signer.ts',
    'src/modules/payment/payment-runner.service.ts',
    'z-test/unit/paytool-p2-runner.spec.ts',
  ];

  it.each(files)('%s carries no 32-hex secret literal', (rel) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    const src = fs.readFileSync(rel, 'utf8');

    // Quoted 32-char hex = the shape of an HMAC secret. Test fixtures should
    // use an obviously-fake string instead ('unit-test-not-a-real-...').
    const hits = src.match(/['"][0-9a-f]{32}['"]/g) ?? [];
    expect(hits).toEqual([]);
  });
});
