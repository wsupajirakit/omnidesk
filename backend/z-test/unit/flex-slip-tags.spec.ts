/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] golden test for the slip tag substitution ====
 *
 * WHY THIS EXISTS, AND WHY IT WAS WRITTEN BEFORE THE REFACTOR:
 * `slip-flex.handler.ts` is a byte-faithful port of the legacy PHP/JS slip flow —
 * its own header says so, and its comments cite legacy line numbers. The tag map
 * and brace substitution inside it (`legacy:3556-3596`) is about to be lifted into
 * `flex-slip-tags.util.ts` so the payment reply path can reuse it instead of
 * copying 40 lines. A refactor of ported code is only safe if "the output did not
 * change" is a MEASUREMENT, so this file pins the output first.
 *
 * WHAT IT PINS: the exact substituted card for a realistic slip — every one of the
 * 11 tags, both synonyms, the `en-US` thousands/2-decimal amount format, the Thai
 * date, the bank-logo URL shape, the th-before-en name preference, and the
 * case-insensitive / whitespace-tolerant brace matching. If the extraction changes
 * any of them, these expectations fail.
 *
 * ⚠️ THESE VALUES ARE THE CONTRACT, NOT A SNAPSHOT TO REGENERATE. An admin's card
 * renders through this substitution, so a "harmless" formatting change (1500 vs
 * 1,500.00) silently rewrites what customers read. If a test here fails, the
 * question is whether the CODE regressed — do not update the numbers to match.
 * ค่าที่เขียนไว้คือสัญญา ไม่ใช่ snapshot ที่ปรับตามโค้ด.
 */
import {
  buildSlipTagMap,
  substituteSlipTags,
} from '@/modules/webhook/slip-flex/flex-slip-tags.util';

/** A realistic Swiftcheck `rawSlip`, shaped exactly as the handler receives it. */
const V_DATA = {
  amount: { amount: 1500 },
  date: '2026-04-06T08:03:07+07:00',
  sender: {
    bank: { id: '006', name: 'ธนาคารกรุงไทย' },
    account: {
      name: { th: 'น.ส.ญาณเทพ ป', en: 'MS. YANTHEP P' },
      bank: { account: 'XXX-X-XX564-4' },
    },
  },
  receiver: {
    bank: { id: '014', name: 'ธนาคารไทยพาณิชย์' },
    account: {
      name: { th: 'บจก. บุญโฟน', en: 'ACME CO' },
      bank: { account: 'XXX-X-XX917-2' },
    },
  },
};

const CHECKED_AT = new Date('2026-04-06T15:26:10+07:00');
const BASE_URL = 'https://cdn.example.test';
/** Stand-in for the handler's own `deps.formatThaiDateTime`. */
const fmtThai = () => '06/04/2569 15:26:10';

const ctx = {
  vData: V_DATA,
  baseUrl: BASE_URL,
  slipCreatedAt: CHECKED_AT,
  formatThaiDateTime: fmtThai,
};

describe('[FEAT-20260810-PAYSTATEFLEX] slip tag map', () => {
  it('formats the amount with thousands separators and exactly 2 decimals', () => {
    // 1500 must read as "1,500.00" — the format customers see on every card.
    expect(buildSlipTagMap(ctx).amount).toBe('1,500.00');
  });

  it('formats a zero/missing amount rather than emitting NaN or empty', () => {
    const zero = buildSlipTagMap({ ...ctx, vData: { ...V_DATA, amount: {} } });
    expect(zero.amount).toBe('0.00');
  });

  it('renders the slip date in Thai and mirrors it to date_on_slip', () => {
    const m = buildSlipTagMap(ctx);
    expect(m.slip_date).toContain('เมษายน');
    // legacy kept both names for the same value; both must stay populated.
    expect(m.date_on_slip).toBe(m.slip_date);
  });

  it('mirrors check_datetime to current_datetime', () => {
    const m = buildSlipTagMap(ctx);
    expect(m.check_datetime).toBe('06/04/2569 15:26:10');
    expect(m.current_datetime).toBe(m.check_datetime);
  });

  /* [FIX-20260812-BANKLOGOKEY] Inverted from the [BUG-20260810-BANKLOGOKEY] pin,
   * exactly as that pin instructed. Swiftcheck's numeric `bank.id` now resolves
   * through `bank-logo-code.map.ts`, so a real slip gets the REAL bank logo.
   * เดิม pin ของพังไว้ — แก้แล้วจึงกลับ expectation ตามที่ comment เดิมสั่ง.
   */
  it('resolves the real logo for numeric bank ids (fixed lookup)', () => {
    const m = buildSlipTagMap(ctx); // V_DATA: sender id '006'=ktb, receiver '014'=scb
    expect(m.sender_bank_logo).toBe(`${BASE_URL}/bank-logos/ktb.png`);
    expect(m.receiver_bank_logo).toBe(`${BASE_URL}/bank-logos/scb.png`);
  });

  it('prefixes the base url when the bank IS found by key', () => {
    // Proves the prefixing half works; only the numeric lookup above is broken.
    const byKey = buildSlipTagMap({
      ...ctx,
      vData: { ...V_DATA, sender: { bank: { id: 'ktb' }, account: {} } },
    });
    expect(byKey.sender_bank_logo).toBe(`${BASE_URL}/bank-logos/ktb.png`);
  });

  it('prefers the Thai name and falls back to English, then N/A', () => {
    expect(buildSlipTagMap(ctx).sender_name).toBe('น.ส.ญาณเทพ ป');

    const enOnly = buildSlipTagMap({
      ...ctx,
      vData: {
        ...V_DATA,
        sender: {
          ...V_DATA.sender,
          account: { ...V_DATA.sender.account, name: { en: 'MS. YANTHEP P' } },
        },
      },
    });
    expect(enOnly.sender_name).toBe('MS. YANTHEP P');

    const noName = buildSlipTagMap({
      ...ctx,
      vData: { ...V_DATA, sender: { bank: {}, account: {} } },
    });
    // 'N/A' is legacy's placeholder — an empty string would leave a blank row.
    expect(noName.sender_name).toBe('N/A');
    expect(noName.sender_acc_no).toBe('N/A');
  });

  it('carries the masked account numbers through untouched', () => {
    const m = buildSlipTagMap(ctx);
    expect(m.sender_acc_no).toBe('XXX-X-XX564-4');
    expect(m.receiver_acc_no).toBe('XXX-X-XX917-2');
  });

  it('exposes exactly the 13 documented keys', () => {
    // 11 tags in the FE guideline table + the 2 legacy synonyms. A new key here
    // without a guideline row is a tag admins can never type (allowlist).
    expect(Object.keys(buildSlipTagMap(ctx)).sort()).toEqual(
      [
        'amount',
        'check_datetime',
        'current_datetime',
        'date_on_slip',
        'receiver_acc_no',
        'receiver_bank_logo',
        'receiver_bank_name',
        'receiver_name',
        'sender_acc_no',
        'sender_bank_logo',
        'sender_bank_name',
        'sender_name',
        'slip_date',
      ].sort(),
    );
  });
});

describe('[FEAT-20260810-PAYSTATEFLEX] brace substitution', () => {
  it('substitutes a tag anywhere in the card, including nested nodes', () => {
    const card = {
      type: 'bubble',
      body: {
        contents: [
          { type: 'text', text: 'ยอด {{amount}} บาท' },
          { type: 'image', url: '{{sender_bank_logo}}' },
        ],
      },
    };
    const out = substituteSlipTags(card, ctx) as any;
    expect(out.body.contents[0].text).toBe('ยอด 1,500.00 บาท');
    // A url node is substituted too; the value is the default logo here because
    // of [BUG-20260810-BANKLOGOKEY] above — what matters is that it resolved.
    expect(out.body.contents[1].url).not.toContain('{{');
    expect(out.body.contents[1].url).toBe(
      buildSlipTagMap(ctx).sender_bank_logo,
    );
  });

  it('matches case-insensitively and tolerates inner whitespace', () => {
    // legacy:3581-3588 used /\{\{\s*tag\s*\}\}/gi — both must keep working, or
    // cards written against the old behaviour would suddenly show raw braces.
    const out = substituteSlipTags(
      { a: '{{ AMOUNT }}', b: '{{Amount}}', c: '{{amount}}' },
      ctx,
    ) as any;
    expect([out.a, out.b, out.c]).toEqual(['1,500.00', '1,500.00', '1,500.00']);
  });

  it('replaces every occurrence, not just the first', () => {
    const out = substituteSlipTags({ t: '{{amount}}/{{amount}}' }, ctx) as any;
    expect(out.t).toBe('1,500.00/1,500.00');
  });

  it('leaves an unknown tag untouched and reports it', () => {
    // The handler warns on leftovers; the util must surface them so the caller
    // can log rather than silently ship "{{nope}}" to a customer.
    const res = substituteSlipTags({ t: '{{nope}}' }, ctx, { report: true });
    expect((res as any).leftover).toEqual(['{{nope}}']);
  });

  it('does not mutate the card it was given', () => {
    const card = { t: '{{amount}}' };
    substituteSlipTags(card, ctx);
    expect(card.t).toBe('{{amount}}');
  });

  it('returns the card unchanged when there is no slip data', () => {
    const card = { t: '{{amount}}' };
    const out = substituteSlipTags(card, { ...ctx, vData: null }) as any;
    expect(out.t).toBe('{{amount}}');
  });
});
