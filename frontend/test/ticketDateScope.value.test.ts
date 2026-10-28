/* [FEAT-20260808-DATESCOPE] Date-scope (within_days) contract for the ticket list + count
 * services. The owner's seamless requirement: when scope = "ทั้งหมด" the request must be
 * BYTE-IDENTICAL to today (NO within_days param); when scope = N days the request carries
 * within_days=N. We assert the exact URL the service hands to authFetch — the single seam the
 * TicketChat page threads the param through (fetchActive / fetchCompleted / the count metas).
 *
 * These are pure service tests (no WS, no React) — they prove the FE builds to the fixed BE
 * contract regardless of whether the BE param exists yet: all-mode omits it (works vs today's
 * BE unchanged); N-day sends it (lights up once BE lands).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture every URL the service fetches. handleApiResponse is stubbed to a benign success so the
// service functions resolve; we only care about the URL/query string that reached authFetch.
const calls: string[] = [];
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'https://api.test',
  authFetch: (url: string) => { calls.push(url); return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve({ success: true, data: [], metas: {}, pagination: { total: 0 } }) } as any); },
  handleApiResponse: (r: any) => r.json(),
}));

import { ticketService } from '../services/chat/ticketService';

const qs = (url: string) => new URL(url).searchParams;

beforeEach(() => { calls.length = 0; });

describe('ticket date-scope — within_days contract', () => {
  // ── ALL-MODE (ทั้งหมด) = identical to today: param OMITTED everywhere ──────────
  it('LIST by group: ทั้งหมด (within_days undefined) omits the param — request byte-identical to today', async () => {
    await ticketService.listTicketsByGroup('g1', { job_status: '0,1', limit: 'all', within_days: undefined });
    expect(calls).toHaveLength(1);
    expect(qs(calls[0]).has('within_days')).toBe(false);
    // sanity: the rest of the query is exactly what it is today
    expect(qs(calls[0]).get('job_status')).toBe('0,1');
    expect(qs(calls[0]).get('limit')).toBe('all');
  });

  it('LIST by group: no within_days key at all → URL matches the pre-feature call exactly', async () => {
    await ticketService.listTicketsByGroup('g1', { job_status: '0,1', limit: 'all' });
    const withKey = calls[0];
    calls.length = 0;
    await ticketService.listTicketsByGroup('g1', { job_status: '0,1', limit: 'all', within_days: undefined });
    // Passing within_days: undefined must produce the SAME URL as not passing it at all.
    expect(calls[0]).toBe(withKey);
  });

  it('LIST by hook: ทั้งหมด omits the param', async () => {
    await ticketService.listTicketsByHook('h1', { job_status: '0,1', limit: 'all', within_days: undefined });
    expect(qs(calls[0]).has('within_days')).toBe(false);
  });

  it('COUNT meta (per-group): ทั้งหมด omits the param', async () => {
    await ticketService.getTicketMetaByGroup('g1', undefined);
    expect(qs(calls[0]).has('within_days')).toBe(false);
  });

  it('COUNT meta (batch): ทั้งหมด keeps the URL identical to today (only groups=…)', async () => {
    await ticketService.getTicketMetaBatchRaw(['g1', 'g2'], undefined);
    expect(qs(calls[0]).has('within_days')).toBe(false);
    expect(qs(calls[0]).get('groups')).toBe('g1,g2');
  });

  // ── N-DAY mode: within_days=N sent on BOTH the list and the count endpoints ────
  it('LIST by group: 3 วัน sends within_days=3', async () => {
    await ticketService.listTicketsByGroup('g1', { job_status: '0,1', limit: 'all', within_days: 3 });
    expect(qs(calls[0]).get('within_days')).toBe('3');
  });

  it('LIST by hook: 5 วัน sends within_days=5', async () => {
    await ticketService.listTicketsByHook('h1', { job_status: '0,1', limit: 'all', within_days: 5 });
    expect(qs(calls[0]).get('within_days')).toBe('5');
  });

  it('COUNT meta (per-group + batch): N วัน scopes the counts too (list ↔ counts stay consistent)', async () => {
    await ticketService.getTicketMetaByGroup('g1', 7);
    await ticketService.getTicketMetaBatchRaw(['g1', 'g2'], 7);
    expect(qs(calls[0]).get('within_days')).toBe('7');
    expect(qs(calls[1]).get('within_days')).toBe('7');
  });
});
