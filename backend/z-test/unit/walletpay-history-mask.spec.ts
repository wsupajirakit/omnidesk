/**
 * [FEAT-20260816-WALLETPAYCARD] the WalletPay card's masking contract.
 *
 * The owner's rules, each one a case here:
 *   1. anything id-SHAPED is masked, whatever key it sits under
 *   2. ~70% hidden / ~30% visible
 *   3. the values an admin must read (amount, time, status, words) stay intact
 *   4. masking is applied to the WHOLE response — rows AND the raw modal payload
 *      — so nothing leaks through a nested corner
 */
/* Imported from the FILE, not the barrel: the barrel also exports the Nest
   controller, and pulling that into a pure unit test drags the DI graph in. */
import {
  looksLikeId,
  maskId,
  maskIdsDeep,
} from '@/modules/chat/walletpay-history/walletpay-mask.util';

const UUID = '00000000-0000-4000-8000-000000000029';
const LINE_ID = 'Ubd88e26129e244f2b63527b834e94dd7';
const OBJECT_ID = 'a0d000000000000000000090';

describe('[WALLETPAYCARD] id masking', () => {
  /* [FIX-20260816-BLUR90] the ratio was pinned at ~70% masked when the card was
     built; the owner raised it to 90% the same day after seeing a real modal.
     The case is FLIPPED (not deleted) so the new rule stays measured. */
  it('(M1) masks ~90% and keeps ~10% readable', () => {
    // maskId is exercised directly here — what it is APPLIED to is decided by
    // the shape rules (see M2: refId is deliberately not one of them).
    const out = maskId(LINE_ID);
    expect(out).toContain('…');
    const visible = out.replace('…', '').length;
    const ratio = visible / LINE_ID.length;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.2); // ≈10% visible ⇒ ≈90% masked
    expect(out).not.toBe(LINE_ID);
  });

  /* [FIX-20260816-BLURSTORAGE] the leak the owner spotted in a live modal: the
     walletpay upload block carries an s3 object name (32-hex) and a `sig=` token
     (64-hex) inside `path`/`url`. Neither was an "id" by the old rules. */
  it('(M6 ⭐ NO LEAK) blurs storage object names and signatures inside URLs', () => {
    const objectName = '1b91875fd9205d10961fc60a551ba96d';
    const sig =
      '47d7ca928b3a0fdbf843ba8c469c80c18b82c5bceb1af87b6622cf866db58fcc';
    const payload = {
      path: `s3:uploads/bank_slips/20260816/${objectName}`,
      url: `slip-images/s3:uploads/bank_slips/20260816/${objectName}?expires=1786870441&sig=${sig}`,
    };
    const text = JSON.stringify(maskIdsDeep(payload));
    expect(text).not.toContain(objectName);
    expect(text).not.toContain(sig);
    /* [FIX-20260816-BLURURL] the owner later asked for whole URLs to be blurred
       ~80% as well, so the middle of the path (including `bank_slips`) is now
       covered too — only the scheme/host head and a short tail remain. The
       assertion is flipped to match that stronger rule. */
    expect(text).toContain('s3:upl');
    expect(text).toContain('…');
  });

  /* [FIX-20260816-REFIDCLEAR] the UUID expectation is FLIPPED, not deleted: the
     owner ruled on 16/08 that refId must stay readable (an admin pastes it into
     walletpay's console; it is not a secret). Identity values still mask. */
  it('(M2) masks identity values by SHAPE — but leaves refId (UUID) readable', () => {
    expect(looksLikeId(UUID)).toBe(false); // refId — readable on purpose
    expect(looksLikeId(LINE_ID)).toBe(true);
    expect(looksLikeId(OBJECT_ID)).toBe(true);
    // …and leaves the things an admin reads alone
    expect(looksLikeId('walletpay')).toBe(false);
    expect(looksLikeId('no_match')).toBe(false);
    expect(looksLikeId('waiting-deposit')).toBe(false);
    expect(looksLikeId('2026-08-16T08:39:02.196Z')).toBe(false);
  });

  it('(M3 ⭐ NO LEAK) masks ids at ANY depth and under ANY key', () => {
    const payload = {
      refId: UUID,
      member_user_id: LINE_ID,
      nested: {
        deeper: [{ whatever_key_name: OBJECT_ID }, { line_user_id: LINE_ID }],
      },
      request: { url: `https://host/api/v1/public/payin/${UUID}/slip` },
    };
    const masked = maskIdsDeep(payload);
    const text = JSON.stringify(masked);
    // refId (UUID) intentionally survives — see M2
    expect(text).toContain(UUID);
    expect(text).not.toContain(LINE_ID);
    expect(text).not.toContain(OBJECT_ID);
  });

  it('(M4 PIN) numbers, booleans, dates and short words survive untouched', () => {
    const payload = {
      amount: 400,
      http_status: 200,
      ok: true,
      at: '2026-08-16T08:39:02.196Z',
      status: 'no_match',
      message: 'Slip uploaded successfully. Waiting for admin to confirm.',
      nothing: null,
    };
    expect(maskIdsDeep(payload)).toEqual(payload);
  });

  it('(M5) never throws on hostile input — deep nesting is cut, not fatal', () => {
    let deep: Record<string, unknown> = { id: UUID };
    for (let i = 0; i < 40; i++) deep = { level: deep };
    expect(() => maskIdsDeep(deep)).not.toThrow();
  });
});
