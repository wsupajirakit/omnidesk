/* [FEAT-20260811-PAYFLEXEYE] ลูกตาบนหัวข้อ "ผูก flex card ต่อ reply state" —
 * MOUNTED and CLICKED, not read as text: the guide must actually appear, carry every
 * BE ReplyState key verbatim, and the eye must not fold the block it lives on
 * (the header itself is the fold button — a propagated click would collapse it).
 *
 * The 8 keys asserted here are the BE `ReplyState` set
 * (omnidesk-api payment-runner.service.ts) — if a state is added there, the guide,
 * PAY_STATE_GROUPS and THIS list must all grow in the same PR.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

/* [FEAT-20260811-PAYRESPEXAMPLES] the raw bodies now come from the BE spec route;
 * the mock returns the same real captures so the render path is exercised end to
 * end (fetch → state → <pre> blocks) without a server. */
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    paymentReplyExamplesService: {
      getHookModalReplyStateResponseExamples: () =>
        Promise.resolve({
          walletpay_success: [
            { label: 'walletpay 200 (2026-08-09)', raw: '{"matchResult":{"status":"matched","message":"[AUTOMATCH] …","confirmed":true}},"messageType":"SINGLE_MATCHED"' },
          ],
          matched_pending: [
            { label: 'walletpay 200 (2026-08-09 · partial)', raw: '{"matchResult":{"message":"(… status: PROCESSING)","confirmed":false}}' },
          ],
          no_match_retry: [
            { label: 'walletpay 200 (2026-08-11)', raw: '{"matchResult":{"status":"invalid_destination"},"messageType":"SINGLE_NOT_MATCHED"}' },
          ],
          statement_not_found: [
            { label: 'walletpay 400', raw: '{"code":4000,"message":"Invalid refId"}' },
            { label: 'walletpay 404', raw: '{"code":4040,"message":"PayIn transaction not found"}' },
            { label: 'walletpay 400', raw: '{"code":4001,"message":"Missing slip file (field name: slip)"}' },
          ],
          not_linked: [
            { label: 'topup 404', raw: '{"error":{"code":"CUSTOMER_NOT_LINKED"}}' },
          ],
        }),
    },
  };
});

import { I18nProvider } from '../i18n';
import HookPaymentFlexBlock from '../components/hook/HookPaymentFlexBlock';

const ALL_STATES = [
  'topup_success',
  'walletpay_success',
  'matched_pending',
  'no_match_retry',
  'statement_not_found',
  'not_linked',
  'member_not_match',
  'review',
];

const mount = () =>
  render(
    <I18nProvider>
      <HookPaymentFlexBlock
        value={{}}
        onChange={() => {}}
        slipTemplates={[{ id: 'card1', name: 'การ์ด 1' } as never]}
      />
    </I18nProvider>,
  );

describe('[PAYFLEXEYE] state guide behind the eye icon', () => {
  it('eye click opens the guide with every ReplyState key, and opens the folded block', () => {
    const { container, queryByTestId, getByTestId } = mount();

    // Folded by default, no guide anywhere.
    expect(queryByTestId('payflex-state-guide')).toBeNull();

    const eye = container.querySelector('[aria-label]') as HTMLElement;
    expect(eye).toBeTruthy();
    fireEvent.click(eye);

    // Guide visible even though the block started folded — the eye unfolds it too.
    const guide = getByTestId('payflex-state-guide');
    for (const state of ALL_STATES) {
      // The verbatim code key is rendered in a <code> chip per row.
      expect(guide.textContent).toContain(state);
    }
  });

  it('eye click does NOT fold the block (stopPropagation on the fold header)', () => {
    const { container, getByTestId, queryByTestId } = mount();
    const header = container.querySelector('button[aria-expanded]') as HTMLElement;
    /* [FEAT-20261018-EXTAPICARDS] flipped 18/10/2026 — owner: "พับปิดได้ทุกการ์ด default เปิด".
       The block now STARTS open, so the old opening click (which assumed a folded start) would
       fold it; the case still proves what it is about: the eye never folds the block. */
    expect(header.getAttribute('aria-expanded')).toBe('true');

    const eye = container.querySelector('[aria-label]') as HTMLElement;
    fireEvent.click(eye); // guide on — block must stay open
    expect(header.getAttribute('aria-expanded')).toBe('true');
    getByTestId('payflex-state-guide');

    fireEvent.click(eye); // guide off — block still open
    expect(queryByTestId('payflex-state-guide')).toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('every state has all explanation lines translated (no raw i18n keys leaking)', () => {
    const { container, getByTestId } = mount();
    fireEvent.click(container.querySelector('[aria-label]') as HTMLElement);
    const text = getByTestId('payflex-state-guide').textContent || '';
    // A missing translation renders the key itself — that must never appear.
    expect(text).not.toContain('payflex_eye_tech_');
    expect(text).not.toContain('payflex_eye_plain_');
    expect(text).not.toContain('payflex_eye_src_');
    expect(text).not.toContain('payflex_eye_sec_');
  });

  it('renders the five flow dividers in real flow order (swiftcheck → topup → gate → walletpay → system)', () => {
    const { container, getByTestId } = mount();
    fireEvent.click(container.querySelector('[aria-label]') as HTMLElement);
    const text = getByTestId('payflex-state-guide').textContent || '';
    const order = ['①', '②', '③', '④', '⑤'].map((m) => text.indexOf(m));
    // All five present…
    order.forEach((i) => expect(i).toBeGreaterThan(-1));
    // …and in flow order, not UI-group order.
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('loads the raw response examples from the BE spec route and renders them', async () => {
    const { container, getByTestId } = mount();
    fireEvent.click(container.querySelector('[aria-label]') as HTMLElement);
    await waitFor(() => {
      const text = getByTestId('payflex-state-guide').textContent || '';
      // one anchor per state that carries a capture — served, not hardcoded
      expect(text).toContain('SINGLE_NOT_MATCHED');
      expect(text).toContain('invalid_destination');
      expect(text).toContain('AUTOMATCH'); // walletpay_success shape 1
      expect(text).toContain('PROCESSING'); // matched_pending shape 2
      expect(text).toContain('"code":4000');
      expect(text).toContain('"code":4040');
      expect(text).toContain('"code":4001');
      expect(text).toContain('CUSTOMER_NOT_LINKED');
    });
  });
});
