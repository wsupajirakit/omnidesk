/**
 * [PERF-20260821-TICKETCURSOR] The ended ("ปิดเคส") tab pages by cursor.
 * Pinned at the service layer: what reaches the BE, and that a caller who does
 * not pass `cursor` sends the exact query it always did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'https://api.test',
  authFetch: (url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ success: true, data: [], pagination: { total: 0, limit: 100, has_more: false, next_cursor: null } }),
    } as unknown as Response);
  },
  handleApiResponse: (r: Response) => r.json(),
}));

import { ticketService, CLOSED_PAGE_SIZE, closedListParams } from '../services/chat/ticketService';

const qs = (u: string) => new URL(u).searchParams;

describe('ticketService list params + cursor', () => {
  beforeEach(() => { calls.length = 0; });

  it('no cursor → no `cursor` key in the URL (legacy request, byte-identical)', async () => {
    await ticketService.listTicketsByGroup('g1', { job_status: 2, limit: 'all' });
    expect(qs(calls[0]!).has('cursor')).toBe(false);
    expect(qs(calls[0]!).get('limit')).toBe('all');
  });

  it("cursor '' → first page: cursor key PRESENT and empty, limit numeric", async () => {
    await ticketService.listTicketsByHook('h1', { job_status: 2, limit: CLOSED_PAGE_SIZE, cursor: '' });
    expect(qs(calls[0]!).has('cursor')).toBe(true);
    expect(qs(calls[0]!).get('cursor')).toBe('');
    expect(qs(calls[0]!).get('limit')).toBe(String(CLOSED_PAGE_SIZE));
  });

  it('next page → the opaque cursor travels verbatim', async () => {
    await ticketService.listTicketsByGroup('g1', { job_status: 2, limit: CLOSED_PAGE_SIZE, cursor: 'abc.def' });
    expect(qs(calls[0]!).get('cursor')).toBe('abc.def');
  });
});

describe('closedListParams — the one place that decides legacy vs cursor', () => {
  it('paging on (default) → cursor mode with the page size; scope + search pass through', () => {
    expect(closedListParams({ cursor: '', withinDays: 3, search: 'x' }, true)).toEqual({
      job_status: 2, limit: CLOSED_PAGE_SIZE, cursor: '', within_days: 3, search: 'x',
    });
  });
  it("paging off (kill switch) → today's exact params: limit 'all', no cursor", () => {
    expect(closedListParams({ cursor: '', withinDays: undefined, search: undefined }, false)).toEqual({
      job_status: 2, limit: 'all', within_days: undefined, search: undefined,
    });
  });
  /* [FEAT-20261019-CATFILTER] a category is a client-side MATCH (aliases, null ⇒ อื่นๆ), so a
     paged closed list would only filter the rows already loaded. Same rule the open tabs follow
     (activeListParams): a chosen category ⇒ the full fetch. No category ⇒ exactly as above. */
  it('⭐ a chosen category ⇒ the full fetch even with paging on (no cursor)', () => {
    expect(closedListParams({ cursor: 'abc', withinDays: 3, search: 'x', categoryLabel: 'ทวงถาม' }, true)).toEqual({
      job_status: 2, limit: 'all', within_days: 3, search: 'x',
    });
  });
  it('🔴 PIN — no category (undefined or empty) ⇒ the cursor page, unchanged', () => {
    for (const categoryLabel of [undefined, '']) {
      expect(closedListParams({ cursor: '', withinDays: 3, search: 'x', categoryLabel }, true)).toEqual({
        job_status: 2, limit: CLOSED_PAGE_SIZE, cursor: '', within_days: 3, search: 'x',
      });
    }
  });
});
