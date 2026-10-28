import {
  HELPER_FALLBACK_URI,
  resolveCustomerHelperFlex,
} from '@/modules/webhook/hook-reply/customer-helper-flex';

/**
 * ==== [FIX-20260810-HELPERURIFILL] ====
 *
 * The bug this pins: a bound card whose button `uri` is not http(s) — the owner
 * really typed `"mintt xx"` — used to travel to LINE unchanged. LINE rejects the
 * WHOLE message when a uri action is malformed, so the card never arrived and the
 * reply fell back to plain text carrying the raw `[[[customer-helper]]]` tag.
 *
 * เจอ tag ⇒ ต้องได้การ์ดที่ผูกไว้ + ปุ่มที่ mint แล้วเสมอ ไม่ว่าแอดมินจะพิมพ์
 * `{{cus_land_url}}` หรือไม่ก็ตาม.
 */

const MINT = 'https://cus.example.com/?t=TOKEN123';
const HOOK = { group: 'g1', flex_customerhelper_id: 'card1' };

/** A card shaped exactly like the one the owner built in the Flex editor. */
function card(uri: unknown): Record<string, unknown> {
  const action: Record<string, unknown> = { type: 'uri', label: 'เชื่อมต่อ' };
  // `undefined` models the key being absent altogether, not present-and-empty.
  if (uri !== undefined) action['uri'] = uri;
  return {
    type: 'bubble',
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'button', action },
        {
          type: 'button',
          action: { type: 'message', label: 'แอดมิน', text: 'ติดต่อแอดมิน' },
        },
      ],
    },
  };
}

function deps(content: unknown) {
  return {
    findFlexById: () =>
      Promise.resolve({
        flex_type: 'customerhelper',
        content_json: content,
        group_ids: ['g1'],
      }),
  };
}

/** The `action` object of the nth footer button, as it would reach LINE. */
function footerAction(
  out: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const footer = out['footer'] as Record<string, unknown>;
  const contents = footer['contents'] as Array<Record<string, unknown>>;
  return contents[index]!['action'] as Record<string, unknown>;
}

/** The uri actually handed to LINE for the first (primary) button. */
function sentUri(out: Record<string, unknown>): unknown {
  return footerAction(out, 0)['uri'];
}

describe('[FIX-20260810-HELPERURIFILL] bound customer-helper card always mints', () => {
  // The regression itself: no tag anywhere in the card, yet the button must mint.
  it.each([
    ['the literal the owner typed', 'mintt xx'],
    ['an empty string', ''],
    ['a missing uri key', undefined],
    ['a non-http scheme', 'javascript:alert(1)'],
    ['a non-string value', 42],
  ])('fills the mint URL when uri is %s', async (_label, bad) => {
    const out = await resolveCustomerHelperFlex(HOOK, MINT, deps(card(bad)));
    expect(sentUri(out)).toBe(MINT);
  });

  it('keeps working through the {{cus_land_url}} tag exactly as before', async () => {
    const out = await resolveCustomerHelperFlex(
      HOOK,
      MINT,
      deps(card('{{cus_land_url}}')),
    );
    expect(sentUri(out)).toBe(MINT);
  });

  // The guard that stops this fix from becoming a new bug: a button the admin
  // deliberately pointed somewhere else must survive untouched.
  it('never overwrites a uri that is already http(s)', async () => {
    const out = await resolveCustomerHelperFlex(
      HOOK,
      MINT,
      deps(card('https://promo.example.com/campaign')),
    );
    expect(sentUri(out)).toBe('https://promo.example.com/campaign');
  });

  it('leaves message actions alone — no uri is invented for them', async () => {
    const out = await resolveCustomerHelperFlex(
      HOOK,
      MINT,
      deps(card('mintt xx')),
    );
    expect(footerAction(out, 1)).toEqual({
      type: 'message',
      label: 'แอดมิน',
      text: 'ติดต่อแอดมิน',
    });
    expect(footerAction(out, 1)['uri']).toBeUndefined();
  });

  it('falls back to HELPER_FALLBACK_URI when minting produced nothing', async () => {
    // mint failed upstream ⇒ connectUri is null. The card must STILL be sendable,
    // so the button gets the fallback rather than a value LINE would reject.
    const out = await resolveCustomerHelperFlex(
      HOOK,
      null,
      deps(card('mintt xx')),
    );
    expect(sentUri(out)).toBe(HELPER_FALLBACK_URI);
  });

  it('reaches uri actions nested deeper than the footer (hero/body)', async () => {
    const nested = {
      type: 'bubble',
      hero: { type: 'image', action: { type: 'uri', uri: 'not-a-url' } },
    };
    const out = await resolveCustomerHelperFlex(HOOK, MINT, deps(nested));
    const hero = out['hero'] as Record<string, unknown>;
    expect((hero['action'] as Record<string, unknown>)['uri']).toBe(MINT);
  });
});
