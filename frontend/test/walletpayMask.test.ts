/**
 * [FEAT-20260816-WALLETPAYCARD] the CLIENT-side masking layer.
 *
 * The BE masks before answering; this is the second net that runs at render
 * time. These cases mirror the BE spec (walletpay-history-mask.spec.ts) so the two
 * layers cannot silently drift apart.
 */
import { describe, it, expect } from 'vitest';
import { maskDeep, maskText, maskValue } from '../components/member/walletpay/walletpayMask';

const UUID = '00000000-0000-4000-8000-000000000029';
const LINE_ID = 'Ubd88e26129e244f2b63527b834e94dd7';
const OBJECT_ID = 'a0d000000000000000000090';

describe('walletpayMask (client layer)', () => {
  // [FIX-20260816-BLUR90] raised from ~70% to ~90% by the owner after seeing a
  // live modal; the case is flipped (not removed) so the new rule stays measured.
  it('hides ~90% of a value', () => {
    const out = maskValue(LINE_ID);
    const visible = out.replace('…', '').length;
    expect(visible / LINE_ID.length).toBeGreaterThan(0.05);
    expect(visible / LINE_ID.length).toBeLessThan(0.2);
  });

  // [FIX-20260816-BLURSTORAGE] s3 object name + sig token inside the upload URL
  it('⭐ NO LEAK: blurs storage object names and signatures inside URLs', () => {
    const objectName = '1b91875fd9205d10961fc60a551ba96d';
    const sig = '47d7ca928b3a0fdbf843ba8c469c80c18b82c5bceb1af87b6622cf866db58fcc';
    const text = JSON.stringify(
      maskDeep({ url: `slip-images/s3:uploads/bank_slips/20260816/${objectName}?sig=${sig}` }),
    );
    expect(text).not.toContain(objectName);
    expect(text).not.toContain(sig);
    expect(text).toContain('bank_slips');
  });

  /* [FIX-20260816-REFIDCLEAR] flipped with the BE rule: identity values mask,
     refId stays readable (an admin pastes it into walletpay's console). */
  it('⭐ NO LEAK: masks identity values anywhere — but keeps refId readable', () => {
    const payload = {
      refId: UUID,
      anything: { deeper: [{ k: OBJECT_ID }, { line_user_id: LINE_ID }] },
      request: { url: `https://host/api/v1/public/payin/${UUID}/slip` },
    };
    const text = JSON.stringify(maskDeep(payload));
    expect(text).toContain(UUID); // refId — on purpose
    expect(text).not.toContain(LINE_ID);
    expect(text).not.toContain(OBJECT_ID);
  });

  it('PIN: amounts, timestamps and status words are untouched', () => {
    const payload = {
      amount: 400,
      http_status: 200,
      at: '2026-08-16T08:39:02.196Z',
      status: 'no_match',
      note: 'Slip uploaded successfully. Waiting for admin to confirm.',
    };
    expect(maskDeep(payload)).toEqual(payload);
    expect(maskText('no_match')).toBe('no_match');
  });

  it('never throws on deep/hostile input', () => {
    let deep: Record<string, unknown> = { id: UUID };
    for (let i = 0; i < 40; i++) deep = { level: deep };
    expect(() => maskDeep(deep)).not.toThrow();
  });
});
