/**
 * [FEAT-20260824-RUNDETAIL] The wire → the modal, with the absences intact.
 * ===========================================================================
 * The screen can only tell "never measured" from "measured, empty" if the
 * service hands the difference over. This file drives `getBroadcastRunDetail`
 * against the SHAPE THE RUNNING SERVER ACTUALLY RETURNS (captured 24/08) and
 * asserts the three fields that must stay absent, stay absent.
 *
 * 🔴 The run-detail route returns the service result DIRECTLY — no `{ data }`
 *    wrapper, unlike `POST :id/preview` right beside it in the controller.
 *    Reading `parsed.data` would be `undefined` forever, with a 200 and an
 *    empty modal and nothing in any log. ตัวนี้ไม่มี data ห่อ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authFetch = vi.fn();
const handleApiResponse = vi.fn();

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'http://api.test',
  authFetch: (...a: unknown[]) => authFetch(...a),
  handleApiResponse: (...a: unknown[]) => handleApiResponse(...a),
}));

import { broadcastService } from '../services/messaging/broadcastService';

/** Trimmed from a real 200 verified against the running server on 24/08. */
const wire = (over: Record<string, unknown> = {}) => ({
  run_id: '00000000-0000-4000-8000-000000000030',
  rows: [
    {
      run_id: '00000000-0000-4000-8000-000000000030',
      broadcast_id: 'a0d000000000000000000096',
      broadcast_name: 'T4 broadcast plain flexid',
      hook_id: 'a0d000000000000000000097',
      hook_alias: 'omnideskdevoa',
      send_kind: 'broadcast',
      card_type: 'plain',
      matched: 0,
      targeted: 1,
      sent: 1,
      failed: 0,
      unsent: 0,
      requests_planned: 1,
      requests_made: 1,
      chunks_planned: 1,
      chunks_done: 1,
      images_replaced: 2,
      unknown_tags: ['amount'],
      status: 'success',
      triggered_by: 'scheduler',
      started_at: '2026-08-24T03:00:00.000Z',
      finished_at: '2026-08-24T03:00:02.000Z',
      settings_snapshot: {
        target: { mode: 'all', group_ids: [], match: 'and', rules: [] },
        schedule: { mode: 'repeat', every_minutes: 10, tz_offset_min: 420 },
        message_flex_id: 'a0d000000000000000000070',
        hook_ids: ['a0d000000000000000000097'],
      },
    },
  ],
  logs: [
    {
      hook_alias: 'demo-oa-three',
      action_type: 'send_broadcast',
      endpoint: 'https://api.line.me/v2/bot/message/multicast',
      method: 'POST',
      status: 'success',
      status_code: 200,
      retries: 0,
      created_at: '2026-08-24T03:00:01.000Z',
    },
  ],
  logsExpired: false,
  ...over,
});

beforeEach(() => {
  authFetch.mockReset();
  handleApiResponse.mockReset();
  authFetch.mockResolvedValue({ ok: true, status: 200 });
});

const call = () => broadcastService.getBroadcastRunDetail('a0d000000000000000000096', 'run-1');

describe('getBroadcastRunDetail — the unwrapped route', () => {
  it('reads the payload at the TOP LEVEL, not under `data`', async () => {
    handleApiResponse.mockResolvedValue(wire());
    const out = await call();
    expect(out.rows).toHaveLength(1);
    expect(out.logs).toHaveLength(1);
    expect(out.rows[0].broadcast_name).toBe('T4 broadcast plain flexid');
  });

  it('asks the run-detail endpoint, with the run id escaped', async () => {
    handleApiResponse.mockResolvedValue(wire());
    await broadcastService.getBroadcastRunDetail('b1', 'a/b');
    expect(authFetch.mock.calls[0][0]).toBe('http://api.test/api/broadcasts/b1/history/a%2Fb');
  });
});

describe('🔴 absent must survive the trip', () => {
  it('keeps images_replaced ABSENT rather than defaulting it to 0', async () => {
    const w = wire();
    delete (w.rows[0] as Record<string, unknown>).images_replaced;
    handleApiResponse.mockResolvedValue(w);
    const out = await call();
    expect('images_replaced' in out.rows[0]).toBe(false);
  });

  it('keeps a measured 0 as 0', async () => {
    const w = wire();
    (w.rows[0] as Record<string, unknown>).images_replaced = 0;
    handleApiResponse.mockResolvedValue(w);
    expect((await call()).rows[0].images_replaced).toBe(0);
  });

  it('🔴 unknown_tags: absent stays absent, [] survives as []', async () => {
    const w = wire();
    delete (w.rows[0] as Record<string, unknown>).unknown_tags;
    handleApiResponse.mockResolvedValue(w);
    expect('unknown_tags' in (await call()).rows[0]).toBe(false);

    const w2 = wire();
    (w2.rows[0] as Record<string, unknown>).unknown_tags = [];
    handleApiResponse.mockResolvedValue(w2);
    expect((await call()).rows[0].unknown_tags).toEqual([]);
  });

  it('🔴 settings_snapshot: absent stays absent, and is copied WHOLE when present', async () => {
    const w = wire();
    delete (w.rows[0] as Record<string, unknown>).settings_snapshot;
    handleApiResponse.mockResolvedValue(w);
    expect('settings_snapshot' in (await call()).rows[0]).toBe(false);

    const w2 = wire();
    (w2.rows[0].settings_snapshot as Record<string, unknown>).a_key_added_later = 'kept';
    handleApiResponse.mockResolvedValue(w2);
    const out = await call();
    // a field-by-field rebuild would silently drop this
    expect(out.rows[0].settings_snapshot?.a_key_added_later).toBe('kept');
  });
});

describe('🔴 logsExpired and logsError stay two different facts', () => {
  it('carries logsExpired straight through, without inferring it from logs.length', async () => {
    handleApiResponse.mockResolvedValue(wire({ logs: [], logsExpired: true }));
    const out = await call();
    expect(out.logsExpired).toBe(true);
    expect(out.logsError).toBeUndefined();
  });

  it('an empty log list with logsExpired FALSE is not turned into an expiry', async () => {
    handleApiResponse.mockResolvedValue(wire({ logs: [], logsExpired: false }));
    expect((await call()).logsExpired).toBe(false);
  });

  it('carries logsError separately, and leaves it absent on success', async () => {
    handleApiResponse.mockResolvedValue(wire({ logs: [], logsExpired: false, logsError: 'read failed' }));
    expect((await call()).logsError).toBe('read failed');
    handleApiResponse.mockResolvedValue(wire());
    expect('logsError' in (await call())).toBe(false);
  });
});
