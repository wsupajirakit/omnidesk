/**
 * [FEAT-20260823-BCASTHISTREAD] The run record, finally on a screen.
 * ===========================================================================
 * A row per OA per run has been written since 22/08 and nothing displayed one.
 *
 * 🔴 THE PROPERTY THIS FILE DEFENDS, at the third and last layer:
 *    `images_replaced` — **absent = nobody looked · 0 = looked, none broken**.
 *    The backend schema omits the field rather than defaulting it, the reader
 *    forwards it only when present, the service copies it only when present,
 *    and this table must SHOW the two differently. Any `?? 0` on the way turns
 *    "never measured" into "measured, all fine".
 *    เติม 0 ให้ค่าที่ไม่มี = โกหกว่าเคยตรวจแล้ว.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));

import { BroadcastHistoryTable } from '../components/campaign/history';
import type { BroadcastHistoryRow } from '../types';

const row = (over: Partial<BroadcastHistoryRow> = {}): BroadcastHistoryRow => ({
  run_id: 'run-1',
  hook_id: 'h1',
  hook_alias: 'OA One',
  matched: 10,
  targeted: 8,
  sent: 7,
  failed: 1,
  unsent: 2,
  requests_planned: 1,
  requests_made: 1,
  chunks_planned: 1,
  chunks_done: 1,
  status: 'partial',
  started_at: '2026-08-22T10:00:00Z',
  finished_at: '2026-08-22T10:00:09Z',
  ...over,
});

const draw = (rows?: BroadcastHistoryRow[], loading = false, error?: string) =>
  render(<BroadcastHistoryTable loading={loading} error={error} rows={rows} />);

describe('images_replaced — absent must LOOK different from zero', () => {
  it('🔴 a run that measured nothing shows a dash, never 0', async () => {
    const v = draw([row()]);
    await waitFor(() => expect(v.queryByTestId('images-run-1')).not.toBeNull());
    expect(v.getByTestId('images-run-1').textContent).toBe('—');
  });

  it('🔴 a measured zero shows 0, not a dash', async () => {
    const v = draw([row({ images_replaced: 0 })]);
    await waitFor(() => expect(v.queryByTestId('images-run-1')).not.toBeNull());
    expect(v.getByTestId('images-run-1').textContent).toBe('0');
  });

  it('a real count is shown as itself', async () => {
    const v = draw([row({ images_replaced: 3 })]);
    await waitFor(() => expect(v.queryByTestId('images-run-1')).not.toBeNull());
    expect(v.getByTestId('images-run-1').textContent).toBe('3');
  });
});

describe('what the table says, and what it refuses to claim', () => {
  it('🔴 spells out that "accepted" is not "delivered"', async () => {
    /* LINE gives no per-recipient receipt on a broadcast, so no column here can
       honestly claim delivery — and an admin reading "sent 7" would assume it.
       ยอมรับคำขอ ≠ ส่งถึงคน. */
    const v = draw([row()]);
    await waitFor(() => expect(v.queryByTestId('broadcast-history')).not.toBeNull());
    expect(v.container.textContent).toContain('broadcast.history_sent_note');
  });

  it('shows the counts and the OA', async () => {
    const v = draw([row()]);
    await waitFor(() => expect(v.container.textContent).toContain('OA One'));
    expect(v.container.textContent).toContain('partial');
  });

  it('a stop reason is shown; nothing invents one when absent', async () => {
    const withReason = draw([row({ stop_reason: 'oa-quota' })]);
    await waitFor(() =>
      expect(withReason.container.textContent).toContain('oa-quota'),
    );
    withReason.unmount();

    const without = draw([row()]);
    await waitFor(() => expect(without.queryByTestId('broadcast-history')).not.toBeNull());
    expect(without.container.textContent).not.toContain('oa-quota');
  });

  it('one row per OA per run — two OAs are two rows', async () => {
    const v = draw([
      row(),
      row({ run_id: 'run-1', hook_id: 'h2', hook_alias: 'OA Two' }),
    ]);
    await waitFor(() => expect(v.container.textContent).toContain('OA Two'));
    expect(v.container.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});

describe('the three empty-ish states are told apart', () => {
  it('🔴 "never ran" has its own message — not a blank table', async () => {
    /* The API answers 404 for a job that does not exist, precisely so this
       message can mean only one thing. ไม่มีงาน กับ ยังไม่เคยรัน คนละเรื่อง. */
    const v = draw([]);
    await waitFor(() => expect(v.queryByTestId('history-empty')).not.toBeNull());
    expect(v.queryByTestId('broadcast-history')).toBeNull();
  });

  it('an error is shown instead of an empty table', async () => {
    const v = draw(undefined, false, 'boom');
    await waitFor(() => expect(v.queryByTestId('history-error')).not.toBeNull());
    expect(v.queryByTestId('history-empty')).toBeNull();
  });

  it('renders nothing at all before the button is pressed', () => {
    const v = draw(undefined);
    expect(v.container.textContent).toBe('');
  });

  it('loading is not the same as empty', async () => {
    const v = draw(undefined, true);
    await waitFor(() => expect(v.container.textContent).toContain('history_loading'));
    expect(v.queryByTestId('history-empty')).toBeNull();
  });
});
