/**
 * [FIX-20260824-TARGETHIDDEN] ทุกช่องที่ BE รองรับ ต้อง "มองเห็นได้จริง" บนจอ
 * ===========================================================================
 * 🔴 ทำไมไฟล์นี้ต้องมี — วันที่ 24/08 เจ้าของเปิดหน้าบรอดแคสต์แล้วถามว่า
 *    "ไหนอะ multicast" · คำตอบคือมันอยู่ในโค้ดครบทุกบรรทัด แต่ถูกครอบด้วย
 *    `<div className="hidden ...">` ⇒ **ส่งขึ้น production แล้วไม่มีใครเห็นสักช่อง**
 *    และอีกสามตัว (ปุ่ม Flex · ปุ่มตั้งเวลา · ช่องวันเวลา) ถูก **ลบทิ้ง** ตั้งแต่
 *    commit แรกของ repo เหลือไว้แค่คอมเมนต์ `{/* ... intentionally hidden *​/}`
 *    ⇒ `title_detail` และ **ตัวตั้งเวลาทั้งระบบ** ไม่มีประตูให้เข้าเลย
 *
 * 🔴 และเทส 1,240 ตัว **เขียวหมดตลอดเวลาที่มันพัง** เพราะ
 *    `getByTestId` / `getByText` **หา element ที่ `display:none` เจอ**
 *    ⇒ "เทสผ่าน" ไม่เคยแปลว่า "คนใช้เห็น" สักครั้ง
 *
 * ⇒ ไฟล์นี้จึงใช้ `toBeVisible()` เท่านั้น ซึ่งเป็นตัวเดียวที่เคารพ `display:none`
 *   ใครเผลอเอา `hidden` กลับมาครอบ หรือลบปุ่มอีก จะแดงที่นี่ทันที
 *   เห็นบนจอ ≠ อยู่ใน DOM — เทสต้องวัดอย่างแรก.
 *
 * ⚠️ ห้ามเปลี่ยน `toBeVisible()` เป็น `toBeInTheDocument()` เพื่อให้ผ่าน
 *    นั่นคือการปิดตาเทสให้กลับไปมองไม่เห็นปัญหาเดิมเป๊ะ ๆ
 *
 * revert: ลบไฟล์นี้ (แล้วจะไม่มีอะไรรู้อีกว่าช่องหายจากจอ)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const payload: { value: unknown } = { value: null };
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(payload.value),
}));
vi.mock('../services/hook', () => ({
  webhookService: {
    getHooksByGroup: () =>
      Promise.resolve([{ _id: 'a0d00000000000000000001e', line_oa_name: 'OA one' }]),
  },
}));
vi.mock('../services/admin', () => ({ fetchVisibleGroups: () => Promise.resolve([]) }));

/* [FEAT-20260825-BCASTFOLD] การ์ดพับเป็นค่าเริ่มต้นตั้งแต่ 25/08 ⇒ กางก่อนทดสอบ
   ดูเหตุผลที่ `openAllFormSections` ใน test/setup.ts */
import { openAllFormSections } from './setup';
import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';

beforeEach(() => {
  payload.value = null;
});

/* ⚠️ `toBeVisible()` เพียงอย่างเดียว **จับ Tailwind `hidden` ไม่ได้** — jsdom ไม่โหลด
   stylesheet ⇒ `class="hidden"` เป็นแค่ชื่อคลาสเปล่า ๆ ไม่มี `display:none` จริง
   ⇒ เทสรอบแรกของไฟล์นี้เขียวทั้งที่ใส่ `hidden` กลับไปแล้ว (mutation จับได้)
   ⇒ ต้องเช็ค **ทั้งสองอย่าง**: computed style (กัน `style="display:none"` / `hidden` attr)
     และบรรพบุรุษที่ถือคลาส `hidden` ของ Tailwind (กันเคสที่เกิดขึ้นจริงเมื่อ 24/08)
   เครื่องมือเดียวไม่พอ ต้องวัดสองทางถึงจะครอบของจริง. */
function expectReachable(el: Element | null): void {
  expect(el).toBeVisible();
  /* `.hidden` ของ Tailwind = `display:none` บนเบราว์เซอร์จริง — ถ้ามันอยู่บนตัวเอง
     หรือบนกล่องพ่อแม่ชั้นไหนก็ตาม ผู้ใช้ไม่มีวันเห็นช่องนี้ */
  expect((el as HTMLElement).closest('.hidden')).toBeNull();
}

const open = () =>
  {
    const r = render(
    <BroadcastFormModal
      isOpen
      onClose={() => {}}
      onSubmit={() => Promise.resolve()}
      mode="create"
    />,
    );
    openAllFormSections(r.container as HTMLElement);
    return r;
  }

describe('[FIX-20260824-TARGETHIDDEN] ช่องตั้งค่าต้องมองเห็นได้ ไม่ใช่แค่มีอยู่ใน DOM', () => {
  it('⭐ "วิธีส่ง" (broadcast / multicast) มองเห็นได้', async () => {
    /* เจ้าของถามตรง ๆ ว่า "ไหนอะ multicast" — นี่คือช่องนั้น */
    const view = open();
    await waitFor(() =>
      expectReachable(view.container.querySelector('select[name="send_kind"]')),
    );
  });

  it('⭐ "เนื้อหาการ์ด" โผล่หลังเลือก multicast — และไม่โผล่ก่อนหน้านั้น', async () => {
    /* ⚠️ ตรงนี้ **ไม่ใช่บั๊ก** — การ์ดรายคนใช้ได้เฉพาะ multicast เท่านั้น
       (`/message/broadcast` ไม่มีรายชื่อผู้รับ จึงแทนค่ารายคนไม่ได้)
       เทสจึงยืนยัน "ประตูเปิดถูกจังหวะ" ไม่ใช่ "เปิดตลอดเวลา" */
    const view = open();
    const { fireEvent } = await import('@testing-library/react');
    const sendKind = await waitFor(() => {
      const el = view.container.querySelector('select[name="send_kind"]');
      expectReachable(el);
      return el as HTMLSelectElement;
    });
    expect(view.container.querySelector('select[name="card_type"]')).toBeNull();

    fireEvent.change(sendKind, { target: { value: 'multicast' } });

    await waitFor(() =>
      expectReachable(view.container.querySelector('select[name="card_type"]')),
    );
  });

  it('⭐ ปุ่มเลือกผู้รับ "ตามเงื่อนไข" มองเห็นได้', async () => {
    /* ประตูเดียวที่เปิด AudienceRuleBuilder — ถ้ามองไม่เห็น ตัวกรองผู้รับ
       ทั้งชุดก็ตั้งค่าไม่ได้ ไม่ว่าโค้ดข้างหลังจะสมบูรณ์แค่ไหน */
    const view = open();
    await waitFor(() =>
      expectReachable(view.container.querySelector('button[name="target_rules"]')),
    );
  });

  it('⭐ ปุ่มประเภทข้อความ Flex มองเห็นได้ — ประตูเดียวสู่ title_detail', async () => {
    const view = open();
    await waitFor(() =>
      expectReachable(view.container.querySelector('button[name="message_type_flex"]')),
    );
  });

  it('⭐ ปุ่ม "ตั้งเวลาส่ง" มองเห็นได้ — ประตูเดียวสู่ scheduler ทั้งระบบ', async () => {
    /* ไม่มีปุ่มนี้ = `status` เป็น 'scheduled' ไม่ได้ = cron/next_run_at/
       claim-lease ที่สร้างไว้ทั้งหมดไม่มีทางถูกสั่งจากหน้าจอ */
    const view = open();
    await waitFor(() =>
      expectReachable(view.container.querySelector('button[name="schedule_scheduled"]')),
    );
  });

  it('⭐ ช่องวันเวลาโผล่เมื่อเลือกตั้งเวลา และไม่โผล่ตอนไม่ได้เลือก', async () => {
    const view = open();
    /* ตอนเริ่ม (ฉบับร่าง) ต้องยังไม่มี — ไม่งั้นค่าจะค้างหลุดขึ้น payload */
    expect(view.container.querySelector('input[name="scheduled_at"]')).toBeNull();

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(
      view.container.querySelector('button[name="schedule_scheduled"]') as HTMLElement,
    );

    await waitFor(() =>
      expectReachable(view.container.querySelector('input[name="scheduled_at"]')),
    );
  });
});
