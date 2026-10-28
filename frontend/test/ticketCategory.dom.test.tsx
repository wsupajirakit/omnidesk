/**
 * [FEAT-20261014-TICKETCATS] Ticket categories come from the back end's customer provider.
 *
 * Owner 14/10/2026: four categories (Collection · IT · Payment · Other) on the loan site,
 * read from the customer provider — never from the `acme_category` config row —
 * and shop-api untouched.
 *
 * TARGET: loan's four show as ทวงถาม · อุปกรณ์ · ชำระค่างวด · อื่นๆ everywhere a category is
 *         shown or offered.
 * PIN (shop-api): the provider answers null ⇒ every screen runs the code it ran before —
 *         the open-case dialog still offers อื่นๆ / แจ้งฝาก, the pages still pick their own set.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { ticketChatPageWithPieces } from './ticketChatSource';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const authFetch = vi.fn();
vi.mock('../services/apiClient', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/apiClient');
  return { ...actual, authFetch: (...a: unknown[]) => authFetch(...a) };
});

import {
  TICKET_CATEGORY_CATALOG,
  TicketCategoryBadge,
  categoryOptionsFor,
  knownCategories,
  ticketCategoryOf,
} from '../components/ticket-category';
import {
  fetchProviderTicketCategories,
  resetProviderTicketCategories,
} from '../services/chat/providerTicketCategories';
import { OpenCaseModal } from '../components/chat/OpenCaseModal';

const LOAN = ['Collection', 'IT', 'Payment', 'Other'];
const ROOT = resolve(__dirname, '..');
const stripCode = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = (rel: string) => stripCode(readFileSync(join(ROOT, rel), 'utf8'));

describe('[TICKETCATS] the catalog', () => {
  it('⭐ four values with legacy Ticket Manager labels', () => {
    expect(Object.keys(TICKET_CATEGORY_CATALOG)).toEqual(LOAN);
    expect(LOAN.map((v) => TICKET_CATEGORY_CATALOG[v as 'IT'].labelTH))
      .toEqual(['ทวงถาม', 'อุปกรณ์', 'ชำระค่างวด', 'อื่นๆ']);
  });
  it('⭐ stored values (and old Thai spellings) land on the right category', () => {
    const set = knownCategories(LOAN);
    expect(ticketCategoryOf('Collection', set)).toBe('Collection');
    expect(ticketCategoryOf('ค่างวด', set)).toBe('Collection');
    // every old Thai spelling the legacy matchers knew (rows may still carry them)
    expect(ticketCategoryOf('ทวงถาม', set)).toBe('Collection');
    expect(ticketCategoryOf('อุปกรณ์', set)).toBe('IT');
    expect(ticketCategoryOf('ชำระค่างวด', set)).toBe('Payment');
    expect(ticketCategoryOf('แจ้งฝาก', set)).toBe('Payment');
    expect(ticketCategoryOf('อื่นๆ', set)).toBe('Other');
    expect(ticketCategoryOf('it', set)).toBe('IT');
    expect(ticketCategoryOf('PAYMENT', set)).toBe('Payment');
    expect(ticketCategoryOf('รับยอด', set)).toBe('Payment');
    expect(ticketCategoryOf('Other', set)).toBe('Other');
  });
  it('anything the set does not name is Other — nothing unreachable', () => {
    const set = knownCategories(LOAN);
    for (const v of ['', null, undefined, 'Loan', 'สินเชื่อ', 'whatever']) {
      expect(ticketCategoryOf(v as string, set)).toBe('Other');
    }
  });
  it('options carry label + matcher in the provider’s order; unknown values dropped', () => {
    const opts = categoryOptionsFor([...LOAN, 'Loan']);
    expect(opts.map((o) => o.label)).toEqual(['ทวงถาม', 'อุปกรณ์', 'ชำระค่างวด', 'อื่นๆ']);
    expect(opts.find((o) => o.value === 'Collection')!.match('Collection')).toBe(true);
    expect(opts.find((o) => o.value === 'Other')!.match('Loan')).toBe(true);
    expect(opts.find((o) => o.value === 'Other')!.match('Collection')).toBe(false);
  });
});

describe('[TICKETCATS] the badge', () => {
  it('⭐ Collection → ทวงถาม (legacy orange)', () => {
    render(<TicketCategoryBadge category="Collection" categories={LOAN} />);
    const el = screen.getByText('ทวงถาม');
    expect(el.className).toContain('bg-orange-100');
  });
  it('IT → อุปกรณ์ · Payment → ชำระค่างวด · Loan → อื่นๆ', () => {
    const { rerender } = render(<TicketCategoryBadge category="IT" categories={LOAN} />);
    expect(screen.getByText('อุปกรณ์')).toBeTruthy();
    rerender(<TicketCategoryBadge category="Payment" categories={LOAN} />);
    expect(screen.getByText('ชำระค่างวด')).toBeTruthy();
    rerender(<TicketCategoryBadge category="Loan" categories={LOAN} />);
    expect(screen.getByText('อื่นๆ')).toBeTruthy();
  });
});

describe('[TICKETCATS] asking the back end', () => {
  beforeEach(() => { resetProviderTicketCategories(); authFetch.mockReset(); });
  const answer = (body: unknown, ok = true) =>
    authFetch.mockResolvedValue({ ok, json: async () => body });

  it('⭐ loan_v1 ⇒ the four', async () => {
    answer({ success: true, data: { ticket_categories: LOAN } });
    expect(await fetchProviderTicketCategories()).toEqual(LOAN);
    expect(String(authFetch.mock.calls[0][0])).toContain('/api/customer-provider/ticket-categories');
  });
  it('⭐ PIN — shop-api answers null ⇒ null', async () => {
    answer({ success: true, data: { ticket_categories: null } });
    expect(await fetchProviderTicketCategories()).toBeNull();
  });
  it('PIN — an older back end (404) or a network failure ⇒ null, never a throw', async () => {
    answer({}, false);
    expect(await fetchProviderTicketCategories()).toBeNull();
    resetProviderTicketCategories();
    authFetch.mockRejectedValue(new Error('down'));
    expect(await fetchProviderTicketCategories()).toBeNull();
  });
  it('⭐ a FAILED answer is not remembered — the next page that asks gets another try', async () => {
    authFetch.mockRejectedValueOnce(new Error('blip'));
    expect(await fetchProviderTicketCategories()).toBeNull();
    answer({ success: true, data: { ticket_categories: LOAN } });
    expect(await fetchProviderTicketCategories()).toEqual(LOAN);
    expect(authFetch).toHaveBeenCalledTimes(2);
  });
  it('a 5xx is not remembered either', async () => {
    authFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    expect(await fetchProviderTicketCategories()).toBeNull();
    answer({ success: true, data: { ticket_categories: LOAN } });
    expect(await fetchProviderTicketCategories()).toEqual(LOAN);
  });
  it('asked once per page load', async () => {
    answer({ success: true, data: { ticket_categories: LOAN } });
    await fetchProviderTicketCategories();
    await fetchProviderTicketCategories();
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});

describe('[TICKETCATS] the open-case dialog', () => {
  const open = (categories?: string[] | null) => {
    const onConfirm = vi.fn();
    render(<OpenCaseModal open categories={categories} onCancel={() => {}} onConfirm={onConfirm} />);
    return onConfirm;
  };
  it('⭐ PIN — no provider set ⇒ อื่นๆ / แจ้งฝาก exactly as before', () => {
    open(null);
    expect(screen.getByText('อื่นๆ')).toBeTruthy();
    expect(screen.getByText('แจ้งฝาก')).toBeTruthy();
    expect(screen.queryByText('ทวงถาม')).toBeNull();
  });
  it('⭐ TARGET — loan ⇒ ทวงถาม · อุปกรณ์ · ชำระค่างวด · อื่นๆ and the chosen VALUE is sent', () => {
    const onConfirm = open(LOAN);
    for (const l of ['ทวงถาม', 'อุปกรณ์', 'ชำระค่างวด', 'อื่นๆ']) expect(screen.getByText(l)).toBeTruthy();
    fireEvent.click(screen.getByText('ทวงถาม'));
    fireEvent.click(screen.getByRole('button', { name: /เปิดเคส/ }));
    expect(onConfirm.mock.calls[0][0].category).toBe('Collection');
  });
  it('loan default is still Other (the same default as before)', () => {
    const onConfirm = open(LOAN);
    fireEvent.click(screen.getByRole('button', { name: /เปิดเคส/ }));
    expect(onConfirm.mock.calls[0][0].category).toBe('Other');
  });
});

describe('[TICKETCATS] every page asks the provider first, and keeps its old set as the fallback', () => {
  it.each([
    ['pages/chat/TicketChat.tsx'],
    ['pages/chat/TicketSupport.tsx'],
  ])('⭐ %s — provider set when declared, else the acme_category set as before', (rel) => {
    const c = code(rel);
    expect(c).toContain('useProviderTicketCategories()');
    expect(c).toMatch(/providerCats\s*\?\s*categoryOptionsFor\(providerCats\)\s*:\s*\(?\s*acmeCategory\s*\?\s*CATEGORIES_LEGACY\s*:\s*CATEGORIES_NARROW/);
  });
  it('⭐ InsightReport — same rule for its filter choices', () => {
    const c = code('pages/insight/InsightReport.tsx');
    expect(c).toContain('useProviderTicketCategories()');
    expect(c).toMatch(/providerCats\s*\?\s*categoryOptionsFor\(providerCats\)\s*:\s*\(?\s*acmeCategory\s*\?\s*CATEGORIES_LEGACY\s*:\s*CATEGORIES_NARROW/);
    // chart, table and export name categories as the filter does; CATEGORY_LABELS otherwise
    expect(c).toMatch(/categoryLabels\s*=\s*providerCats\s*\?\s*categoryOptionsFor\(providerCats\)\s*:\s*CATEGORY_LABELS/);
    expect(c).not.toContain('CATEGORY_LABELS.find(');
  });
  it('⭐ OperationsPanel — provider badge when declared, else getCategoryBadge as before', () => {
    const c = code('components/chat/ticket-detail/OperationsPanel.tsx');
    expect(c).toMatch(/categories\s*\?\s*<TicketCategoryBadge[^>]*\/>\s*:\s*getCategoryBadge\(ticket\.category,\s*acme\)/);
  });
  it('⭐ TicketChat — EVERY badge (card, sub-ticket, panel, tag-info, history) goes through one switch', () => {
    // [REFACTOR-20261027-TCSPLIT] the page's markup moved into pages/chat/ticket-chat/ — read the
    // page with those pieces (test/ticketChatSource.ts); assertions unchanged
    const c = stripCode(ticketChatPageWithPieces());
    // the old badge is called in exactly one place: the fallback of that switch
    expect(c.match(/getCategoryBadge\(/g)?.length).toBe(1);
    expect(c).toMatch(/const categoryBadge = \(cat[^)]*\)\s*=>\s*\(?\s*providerCats\s*\?\s*<TicketCategoryBadge[^>]*\/>\s*:\s*getCategoryBadge\(cat,\s*acmeCategory\)/);
    expect(c.match(/categoryBadge\(/g)?.length).toBe(4); // card · sub-ticket · tag-info · history (the panel badge lives in OperationsPanel)
  });
  it('⭐ TicketSupport badge — provider badge when declared, else its own switch as before', () => {
    const c = code('pages/chat/TicketSupport.tsx');
    expect(c).toMatch(/if\s*\(providerCats\)\s*return\s*<TicketCategoryBadge/);
  });
});
