/**
 * [FEAT-20260823-BCASTTITLE] `title_detail` — the whole path, not just the rule.
 * ===========================================================================
 * WHY THIS FILE EXISTS. `broadcastTitle.value.test.ts` proves the RULE and all
 * ten of its cases passed while the feature was **unreachable**: the validator
 * was wired into `validate()` against a field that had NO INPUT, no place in
 * `DEFAULT_FORM`, no line in the edit reset, and no line in
 * `normalizeBroadcast`. Every layer looked done on its own.
 *
 * Three of those four are the same defect `flexCardTicketRoundTrip` was written
 * for — a function that rebuilds an object field by field silently drops the
 * field you forgot, and the form then writes its blank over a real value.
 * กฎถูกไม่พอ ต้องมีทางเดินจริงตั้งแต่ช่องกรอกจนถึงขากลับ.
 *
 * ⚠️ EVERY CASE HERE OPENS WITH `initialData`, and that is not laziness: a
 *    fresh create cannot reach this field at all. The message-type picker
 *    offers text and image only, so `message.type === 'flex'` — the sole
 *    condition that renders the box — is reachable only by EDITING an existing
 *    flex job or COPYING one (`Broadcasts.tsx:229-237` spreads the whole
 *    entry, title included). One consequence worth knowing: the entry in
 *    `DEFAULT_FORM` is unreachable, so a mutation deleting it stays green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

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
/* `getHooksByGroup` is the real name (`services/hook/webhookService.ts:237`),
   read from the file — a guessed one mounts fine and then throws inside the
   effect, which reads as a failure of the code under test. */
vi.mock('../services/hook', () => ({
  webhookService: {
    getHooksByGroup: () =>
      Promise.resolve([{ _id: 'a0d00000000000000000001e', line_oa_name: 'OA one' }]),
  },
}));
vi.mock('../services/admin', () => ({ fetchVisibleGroups: () => Promise.resolve([]) }));

import { broadcastService } from '../services/messaging/broadcastService';
import { openAllFormSections } from './setup';
import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { TITLE_DEFAULT } from '../utils/broadcastTitle';

beforeEach(() => {
  payload.value = null;
  sent.body = null;
});

/* ── the way BACK, through the real service ─────────────────────────────── */

describe('title_detail survives the read path', () => {
  it('★ a stored title comes out of normalizeBroadcast', async () => {
    payload.value = {
      data: [{ _id: 'b1', name: 'promo', title_detail: 'โปรโมชั่น 2026' }],
      meta: { total: 1 },
    };
    const out = await broadcastService.listBroadcasts({});
    expect(out.data[0]?.title_detail).toBe('โปรโมชั่น 2026');
  });

  it('a row without one reads back as null, never undefined', async () => {
    payload.value = { data: [{ _id: 'b1', name: 'promo' }], meta: { total: 1 } };
    const out = await broadcastService.listBroadcasts({});
    expect(out.data[0]).toHaveProperty('title_detail', null);
  });
});

/* ── the form ───────────────────────────────────────────────────────────── */

const FLEX = { type: 'flex' as const, flex_json: { type: 'bubble' } };

/* Everything `validate()` demands before it will ever look at the title —
   without these the save is blocked for an unrelated reason and a "did not
   submit" assertion would pass for the wrong cause. ต้องผ่านด่านอื่นก่อน. */
const entry = (extra: Record<string, unknown> = {}) => ({
  id: 'b1',
  name: 'promo',
  hook_ids: ['a0d00000000000000000001e'],
  assign_group: 'a0d00000000000000000001e',
  target: { mode: 'all', group_ids: [] },
  message: FLEX,
  status: 'draft',
  ...extra,
});

/** Submit, then clear the confirm step the modal puts in front of onSubmit. */
async function save(view: ReturnType<typeof render>) {
  fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
  /* ⚠️ THE LAST match, not the first. The form's own submit button also reads
     `common.confirm`, and it is EARLIER in the DOM — clicking that one just
     re-submits the form, so the test hangs waiting for an `onSubmit` that the
     confirm dialog was never told to fire. The dialog is appended after the
     panel, so the last match is the dialog's. (i18n has no provider here, so
     every label renders as its raw key.) ปุ่มชื่อซ้ำกัน ต้องเอาตัวหลัง. */
  const confirm = await waitFor(() => {
    const all = Array.from(view.baseElement.querySelectorAll('button')).filter((x) =>
      (x.textContent || '').includes('common.confirm'),
    );
    if (all.length < 2) throw new Error('confirm dialog never opened');
    return all[all.length - 1] as HTMLButtonElement;
  });
  /* [UI-20260825-SENDCONSENT] ⚠️ ตั้งแต่ 25/08 กล่องยืนยันมีช่องติ๊กที่ต้องติ๊ก
     ก่อน ไม่งั้น `confirmSubmit` จะคืนค่าออกไปเฉย ๆ แล้วช่องติ๊กเปลี่ยนเป็นแดง
     (เจ้าของสั่ง: *"ยืนยันก่อนค่อยกด submit"*) ⇒ เทสรอบทางนี้ต้องเดินผ่านขั้นนั้น
     เหมือนคนจริง ไม่ใช่ข้ามมันไป · นี่ไม่ใช่การผ่อนเทส มันคือเส้นทางที่ยาวขึ้นจริง
     ⚠️ ติ๊ก **ก่อน** กดยืนยัน — ติ๊กทีหลังคือคนละลำดับกับที่ผู้ใช้ทำ */
  const consent = view.baseElement.querySelector(
    '[data-testid="send-consent-input"]',
  ) as HTMLInputElement | null;
  if (consent === null) throw new Error('consent tick box never rendered');
  fireEvent.click(consent);
  fireEvent.click(confirm);
}

function open(initialData?: unknown, onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const view = render(
    <BroadcastFormModal
      isOpen
      onClose={() => undefined}
      onSubmit={onSubmit}
      initialData={initialData as never}
    />,
  );
  /* [FEAT-20260825-BCASTFOLD] การ์ดพับเป็นค่าเริ่มต้นตั้งแต่ 25/08 ⇒ กางก่อนทดสอบ
     ดูเหตุผลที่ `openAllFormSections` ใน test/setup.ts */
  openAllFormSections(view.container as HTMLElement);
  return { view, onSubmit };
}

const titleBox = (c: HTMLElement) =>
  c.querySelector('input[name="title_detail"]') as HTMLInputElement | null;

describe('the box exists, and only where it can work', () => {
  it('★ a flex card offers it — this input did not exist at all', async () => {
    const { view } = open(entry());
    await waitFor(() => expect(titleBox(view.container)).not.toBeNull());
  });

  it('🔴 a TEXT card does not — text has no altText to set', async () => {
    /* Offering it would promise something LINE cannot do: a text message's
       notification IS its content. ไม่มี altText ให้ตั้ง. */
    const { view } = open(entry({ message: { type: 'text', text: 'hi' } }));
    await waitFor(() => expect(view.container.querySelector('textarea')).not.toBeNull());
    expect(titleBox(view.container)).toBeNull();
  });

  it('an IMAGE card does not either', async () => {
    /* Wait for the IMAGE field, not for the title box — waiting for something
       that is correctly absent can only ever time out, and the timeout would
       read as the assertion failing. รอสิ่งที่ต้องมี แล้วค่อยยืนยันว่าอีกอันไม่มี. */
    const { view } = open(entry({ message: { type: 'image', image_url: 'https://x/y.png' } }));
    await waitFor(() =>
      expect(view.container.querySelector('input[name="message_image_url"]')).not.toBeNull(),
    );
    expect(titleBox(view.container)).toBeNull();
  });

  it('the placeholder shows what a blank box will actually send', async () => {
    const { view } = open(entry());
    await waitFor(() => expect(titleBox(view.container)).not.toBeNull());
    expect(titleBox(view.container)?.placeholder).toBe(TITLE_DEFAULT);
  });
});

describe('edit → form → save keeps the value intact', () => {
  it('🔴 a stored title appears in the box when the form re-opens', async () => {
    /* The bug this guards: the edit reset rebuilds form state field by field,
       so the box opened EMPTY on a job that had a title — and the next save
       wrote that empty over it. ฟอร์มเปิดมาว่าง แล้วเซฟทับของจริง. */
    const { view } = open(entry({ title_detail: 'โปรโมชั่น 2026' }));
    await waitFor(() => expect(titleBox(view.container)?.value).toBe('โปรโมชั่น 2026'));
  });

  it('★ what the admin types reaches the submitted payload', async () => {
    const { view, onSubmit } = open(entry());
    await waitFor(() => expect(titleBox(view.container)).not.toBeNull());
    fireEvent.change(titleBox(view.container) as HTMLInputElement, {
      target: { value: 'ลดราคา 50' },
    });
    await save(view);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ title_detail: 'ลดราคา 50' });
  });

  it('🔴 an invalid title BLOCKS the save instead of shipping a broken one', async () => {
    const { view, onSubmit } = open(entry());
    await waitFor(() => expect(titleBox(view.container)).not.toBeNull());
    fireEvent.change(titleBox(view.container) as HTMLInputElement, {
      target: { value: 'สวัสดี {{member.display_name}}' },
    });
    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
    await waitFor(() =>
      expect(view.container.textContent).toContain('broadcast.form_title_has_tag'),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('🔴 switching away from flex clears it — no invisible value rides along', async () => {
    /* The box is hidden for text/image. A title still sitting in state would be
       submitted anyway, and the admin could neither see nor correct it.
       ⚠️ There is no button back to flex — the type picker offers only text and
       image (`BroadcastFormModal.tsx:398-425`), so a flex job arrives that way
       from the API. The payload is therefore what proves the clear, not a
       second look at the box. */
    const { view, onSubmit } = open(entry({ title_detail: 'โปรโมชั่น' }));
    await waitFor(() => expect(titleBox(view.container)?.value).toBe('โปรโมชั่น'));

    const textBtn = Array.from(view.container.querySelectorAll('button')).find((b) =>
      (b.textContent || '').includes('broadcast.message_text'),
    );
    expect(textBtn).toBeTruthy();
    fireEvent.click(textBtn as HTMLButtonElement);
    await waitFor(() => expect(titleBox(view.container)).toBeNull());

    const textArea = view.container.querySelector('textarea[name="message_text"]')
      ?? view.container.querySelector('textarea');
    fireEvent.change(textArea as HTMLTextAreaElement, { target: { value: 'สวัสดี' } });
    await save(view);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ title_detail: '' });
  });
});
