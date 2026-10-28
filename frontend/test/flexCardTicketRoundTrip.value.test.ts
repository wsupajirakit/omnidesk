/**
 * [FEAT-20260810-CARDTICKET] — the per-card "open a case for an admin" fields must
 * survive the trip BACK from the API, not just the trip out.
 *
 * WHY THIS FILE EXISTS: the fields were added to the form, the types and the back
 * end, and saving genuinely wrote them to the database — but `normalizeFlexMessage`
 * builds a fresh object field by field, so anything not listed there is dropped on
 * READ. The form then opened blank and a second save pushed `false` / `''` over a
 * real value, silently switching a configured ticket back off.
 *
 * The file it guards already carries the warning that caused this
 * (`[FIX-20260802-SRCLOST2]`: "เพิ่ม column ใหม่ให้การ์ดเมื่อไหร่ ต้องเพิ่มที่นี่ด้วยเสมอ")
 * — a comment was not enough, so this is the executable version of it.
 *
 * เทสขากลับ ไม่ใช่แค่ขาไป — ค่าเข้า DB แล้วแต่หายตอนอ่านกลับ คือบั๊กที่เงียบที่สุด
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// authFetch/handleApiResponse are the only network seams the service touches.
// `sent` captures the request body so the write direction is checked too.
const payload: { value: unknown } = { value: null };
const sent: { body: unknown } = { body: null };
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: (_url: string, init?: { body?: string }) => {
    sent.body = init?.body ? JSON.parse(init.body) : null;
    return Promise.resolve({ ok: true, status: 200 } as never);
  },
  handleApiResponse: () => Promise.resolve(payload.value),
}));

import { flexMessageService } from '../services/media/flexMessageService';

/** Minimal API row, shaped like what the back end really returns. */
const apiRow = (extra: Record<string, unknown> = {}) => ({
  _id: 'card1',
  name: 'PAYreview',
  content_json: { type: 'bubble' },
  flex_type: 'slip',
  ...extra,
});

beforeEach(() => {
  payload.value = null;
  sent.body = null;
});

describe('[FEAT-20260810-CARDTICKET] card ticket fields survive the read path', () => {
  it('★ keeps a configured flag and reason (the bug: both were dropped)', async () => {
    payload.value = {
      data: apiRow({
        direct_ticket_on_reply: true,
        direct_ticket_text: 'ยอดที่โอนมา กับยอดเงิน ในสลิป ไม่ถูกต้อง',
      }),
    };

    const entry = await flexMessageService.getFlexMessage('card1');

    // Before the fix both of these were `undefined`: the form opened blank and a
    // second save wrote the blanks back over a working configuration.
    expect(entry.direct_ticket_on_reply).toBe(true);
    expect(entry.direct_ticket_text).toBe('ยอดที่โอนมา กับยอดเงิน ในสลิป ไม่ถูกต้อง');
  });

  it('reads a card that never set them as off, not undefined', async () => {
    // Every card that existed before this feature is this case. `undefined` would
    // make the checkbox uncontrolled; `false` keeps it a real "off".
    payload.value = { data: apiRow() };
    const entry = await flexMessageService.getFlexMessage('card1');
    expect(entry.direct_ticket_on_reply).toBe(false);
    expect(entry.direct_ticket_text).toBe('');
  });

  it('treats a truthy-but-not-true flag as off', async () => {
    // Guards an older write path or a hand-edited row from turning a ticket on.
    for (const bad of ['true', 'false', 1, {}]) {
      payload.value = { data: apiRow({ direct_ticket_on_reply: bad }) };
      const entry = await flexMessageService.getFlexMessage('card1');
      expect(entry.direct_ticket_on_reply).toBe(false);
    }
  });

  it('sends both fields on save, verbatim', async () => {
    payload.value = { data: apiRow() };
    await flexMessageService.updateFlexMessage('card1', {
      name: 'PAYreview',
      direct_ticket_on_reply: true,
      direct_ticket_text: 'เหตุผลที่แอดมินจะเห็น',
    } as never);

    expect((sent.body as Record<string, unknown>).direct_ticket_on_reply).toBe(true);
    expect((sent.body as Record<string, unknown>).direct_ticket_text).toBe(
      'เหตุผลที่แอดมินจะเห็น',
    );
  });

  it('the list path keeps them too — the table and the edit form share it', async () => {
    payload.value = {
      data: [apiRow({ direct_ticket_on_reply: true, direct_ticket_text: 'r' })],
      meta: { total: 1, page: 1, limit: 25 },
    };
    const res = await flexMessageService.listFlexMessages({});
    expect(res.data[0].direct_ticket_on_reply).toBe(true);
    expect(res.data[0].direct_ticket_text).toBe('r');
  });
});
