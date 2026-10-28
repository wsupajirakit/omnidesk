/**
 * [FIX-20261014-SLIPDETAILNEST] D7 — the slip-detail modal reads the customer at either level.
 * =============================================================================
 * The list hands the modal a light `external_data.{customer,contract}` built from the member;
 * the modal then fetches the detail, whose `external_data` is the partner's RAW profile body —
 * on the loan site `customer` / `contract` sit one level deeper, under `.data` — and the
 * fetched copy replaced the light one, so Name / Number / Contract / Tel went blank.
 *
 * The detail body below is the REAL loan profile answer (generated BE fixture:
 * `fixtures/loanV1RawProfileEnvelopes.json` → `live.data`).
 * PIN: an shop-api body has `customer` at neither level ⇒ the rows stay `-`, exactly as today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import ENVELOPES from './fixtures/loanV1RawProfileEnvelopes.json';

const detail: { value: unknown } = { value: null };
vi.mock('../services/finance', () => ({
  slipVerificationService: { getSlip: () => Promise.resolve({ data: { external_data: detail.value } }) },
}));

import { SlipDetailModal } from '../components/slip/SlipDetailModal';
import { I18nProvider } from '../i18n';

const LIGHT = { customer: { customer_name: 'จากสมาชิก', customer_tel: '0899999999' }, contract: { contract_number: '' } };
const slip = { id: 's1', external_data: LIGHT } as never;
const valueOf = (label: string) =>
  screen.getByText(label).parentElement?.querySelector('span:last-child')?.textContent;

beforeEach(() => {
  detail.value = null;
});

describe('[SLIPDETAILNEST] D7 — the fetched detail fills the customer rows', () => {
  it('TARGET: loan detail (customer under .data) — Name / Number / Contract / Tel are shown', async () => {
    const body = (ENVELOPES as any).live.data;
    detail.value = body;
    render(<I18nProvider><SlipDetailModal isOpen slip={slip} onClose={() => {}} /></I18nProvider>);
    await waitFor(() => expect(valueOf('Customer Name')).toBe(body.data.customer.customer_name));
    expect(valueOf('Customer Number')).toBe(body.data.customer.customer_number);
    expect(valueOf('Contract Number')).toBe(body.data.contract.contract_number);
    expect(valueOf('Tel')).toBe(body.data.customer.customer_tel);
  });

  it('🔴 PIN: the light list copy (customer at the top) still reads as before', async () => {
    detail.value = null; // detail answered nothing ⇒ the list copy stays
    render(<I18nProvider><SlipDetailModal isOpen slip={slip} onClose={() => {}} /></I18nProvider>);
    await waitFor(() => expect(valueOf('Customer Name')).toBe('จากสมาชิก'));
  });

  it('🔴 PIN: an shop-api detail (no customer at either level) leaves the rows as "-", as today', async () => {
    detail.value = { success: true, data: { profile: { phone: '0811111111', member_id: 'M1' } } };
    render(<I18nProvider><SlipDetailModal isOpen slip={slip} onClose={() => {}} /></I18nProvider>);
    await waitFor(() => expect(valueOf('Customer Name')).toBe('-'));
    expect(valueOf('Tel')).toBe('-');
  });
});
