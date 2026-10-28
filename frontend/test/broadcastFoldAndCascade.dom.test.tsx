/**
 * [FEAT-20260825-BCASTFOLD] + [FEAT-20260825-MULTIGROUP]
 * การ์ดพับได้ทุกใบ · และการตัด OA ต้องเทียบกับ **ทุกกลุ่ม** ไม่ใช่กลุ่มแรก
 * ===========================================================================
 * 🔴 ไฟล์นี้เขียนเพิ่มเพราะ **mutation พิสูจน์แล้วว่าไม่มีเทสไหนเห็นสองเรื่องนี้เลย**
 *    เปลี่ยน cascade กลับไปใช้กลุ่มเดียว → 1,513 เคสยังเขียวหมด
 *    เปลี่ยนการ์ดกลุ่มเว็บให้กางค้าง → เขียวหมดเหมือนกัน
 *    ⇒ ทั้งสองอย่างเคย "ทำแล้ว" แต่ไม่มีอะไรกันไม่ให้พัง
 *    เขียวทั้งชุดไม่ได้แปลว่าของที่เพิ่งทำถูกทดสอบ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const GROUPS = [
  { _id: 'g1', group_name: 'Alpha Group' },
  { _id: 'g2', group_name: 'Bravo Group' },
];
/** OA คนละกลุ่มกัน — จุดตายของ cascade อยู่ตรงนี้ */
const HOOKS: Record<string, { _id: string; line_oa_name: string; group: string }[]> = {
  g1: [{ _id: 'h1', line_oa_name: 'OA Alpha', group: 'g1' }],
  g2: [{ _id: 'h2', line_oa_name: 'OA Bravo', group: 'g2' }],
};

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/hook', () => ({
  webhookService: { getHooksByGroup: (id: string) => Promise.resolve(HOOKS[id] ?? []) },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve(GROUPS),
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { pruneHookIds } from '../components/campaign/pickers/pruneHookIds';
import { I18nProvider } from '../i18n';

const onSubmit = vi.fn(() => Promise.resolve());
beforeEach(() => onSubmit.mockClear());

const open = () =>
  render(
    <I18nProvider>
      <BroadcastFormModal isOpen onClose={() => undefined} onSubmit={onSubmit} mode="create" />
    </I18nProvider>,
  );

const q = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** ทุกใบที่ต้องพับได้ — เจ้าของ 25/08: *"ทุก card พับได้"*
 * [FEAT-2708-GRIDPICK] (27/08 งาน 5.3) `section-group`/`section-oa` ถูกถอดจาก
 * ลิสต์นี้: เจ้าของสั่งรอบใหม่ "ไม่ต้องมี พับ...ให้กลางไว้ตลอด" — สองใบนั้นย้ายไป
 * เคส ALWAYS_OPEN ข้างล่างแทน ไม่ได้หายไปเฉย ๆ */
const SECTIONS = [
  'section-basic',
  'section-message',
  'section-target',
  'section-send',
] as const;

/** สองใบที่กางตลอดตามคำสั่ง 27/08 — ไม่มีปุ่มพับ เนื้อในโผล่เสมอ */
const ALWAYS_OPEN = ['section-group', 'section-oa'] as const;

/* [FIX-20260825-LEFTOPEN] เจ้าของ 25/08: *"กล่อง input ฝั่งซ้ายทั้งหมด ฝั่งนี้
   default เปิดไว้เลย (ค่อยกดพับเอง)"* ⇒ สองใบซ้ายกางมาตั้งแต่แรก
   เคสที่ปักว่า "ทุกใบปิดอยู่" จึงถูก **พลิกเฉพาะสองใบนี้** ไม่ได้ลบทิ้ง
   ที่เหลือยังพับเหมือนเดิม และ "กดพับ/กางได้" ยังต้องจริงทุกใบ */
/* ⚠️ [UI-20260825-SENDOPEN] โตขึ้นอีกหนึ่ง — เจ้าของ 25/08 (รอบที่สอง):
   *"div สถานะการส่ง ให้เปิดค้างตลอด (พับค่อยกดเอง) create / edit modal / copy ด้วย"*
   เหตุผลที่เข้ากับกติกาเดิม: การ์ดใบนี้ต้องเลือกก่อนกดยืนยัน **ทุกครั้ง**
   (ส่งทันที / ตั้งเวลา / บันทึกร่าง) จึงเข้าเกณฑ์เดียวกับฝั่งซ้ายคือ
   "ของที่ต้องแตะทุกใบ" ไม่ใช่ "ตัวเลือกที่นาน ๆ ใช้ที"
   ⚠️ ลิสต์นี้แดง = เทสทำงานถูก · โตได้แต่ต้องจดเหตุผลไว้ตรงนี้เสมอ */
const OPEN_BY_DEFAULT = [
  'section-basic',
  'section-message',
  'section-send',
] as const;
const isOpenByDefault = (id: string) =>
  (OPEN_BY_DEFAULT as readonly string[]).includes(id);

describe('[FEAT-20260825-BCASTFOLD] การ์ดพับได้ทุกใบ', () => {
  /* [UI-20260828-NOFOLD] Owner, 28/08: "take the fold arrows out of every div in
     the broadcast create/edit modal". The two cases that used to live here — "every
     card has a toggle, folded by default" and "clicking toggles it" — described the
     PREVIOUS decision and were replaced, not deleted: what they guarded (a card's
     body is really mounted, not merely hidden) is still asserted below, now for
     every card at once.
     The switch is `BROADCAST_SECTIONS_COLLAPSIBLE` in `components/campaign/form/
     FormSection.tsx`. Flip it back to `true` and these expectations are what will
     need flipping too — that is the intended signal, not a nuisance. */
  it('🔴 no card offers a fold toggle, and every card body is rendered', () => {
    const { container } = open();
    for (const id of [...SECTIONS, ...ALWAYS_OPEN]) {
      expect(q(container, `${id}-toggle`), `${id} must not offer a fold toggle`).toBeNull();
      expect(q(container, `${id}-body`), `${id} body must be rendered`).not.toBeNull();
    }
  });

  it('⭐ every card title is still readable, so nothing was lost with the button', () => {
    /* The header used to be the button. Removing it must not remove the heading
       or the error badge slot with it. */
    const { container } = open();
    for (const id of [...SECTIONS, ...ALWAYS_OPEN]) {
      const card = q(container, id);
      expect(card, `${id} must exist`).not.toBeNull();
      expect(card!.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  /** พับแล้วต้องไม่ซ่อน error — ไม่งั้นแอดมินเจอแค่ "เซฟไม่ได้" */
  it('🔴 กดเซฟไม่ผ่าน ⇒ การ์ดที่มีปัญหากางเอง + มีแถบสรุป', async () => {
    const { container } = open();
    fireEvent.submit(container.querySelector('#broadcast-form') as HTMLElement);
    await waitFor(() => {
      expect(q(container, 'form-error-summary')).not.toBeNull();
    });
    /* ชื่อแคมเปญว่าง ⇒ การ์ด "ข้อมูลพื้นฐาน" ต้องถูกกางให้เอง */
    expect(q(container, 'section-basic-body')).not.toBeNull();
    expect(q(container, 'section-basic-error-count')).not.toBeNull();
  });
});

describe('[FEAT-20260825-MULTIGROUP] ตัด OA ต้องเทียบทุกกลุ่ม', () => {
  /**
   * 🔴 หัวใจของบั๊ก: ส่งกลุ่มเดียวเข้าไป ⇒ OA ของกลุ่มที่ 2 ถูกมองว่า "ไม่อยู่ในชุด
   *    ที่อนุญาต" แล้วโดนล้างทิ้ง · แอดมินเห็น OA หายไปเองโดยไม่มีเหตุผล
   */
  it('🔴 ส่งทั้งลิสต์ ⇒ OA ของทุกกลุ่มรอด', () => {
    const hooks = [...HOOKS.g1!, ...HOOKS.g2!];
    expect(pruneHookIds(['h1', 'h2'], hooks as never, ['g1', 'g2'])).toEqual([
      'h1',
      'h2',
    ]);
  });

  it('ส่งกลุ่มเดียว ⇒ OA ของอีกกลุ่มหาย — นี่คือรูปร่างของบั๊ก', () => {
    /* เก็บไว้เป็นหลักฐานว่าทำไมต้องส่งทั้งลิสต์ ไม่ใช่การตกแต่ง */
    const hooks = [...HOOKS.g1!, ...HOOKS.g2!];
    expect(pruneHookIds(['h1', 'h2'], hooks as never, ['g1'])).toEqual(['h1']);
  });

  it('ติ๊กกลุ่มออก ⇒ OA ของกลุ่มนั้นออกตาม (ที่เหลืออยู่ครบ)', () => {
    const hooks = [...HOOKS.g1!, ...HOOKS.g2!];
    expect(pruneHookIds(['h1', 'h2'], hooks as never, ['g2'])).toEqual(['h2']);
  });

  /**
   * source-guard: ถ้ามีคนเปลี่ยนกลับไปส่ง **ค่าเดียว** เทสนี้แดง
   *
   * ⚠️ รอบแรกเขียนเช็คว่าทั้งสองจุดต้องมีคำว่า `prev.assign_group_ids` — **เข้มเกินจริง**
   *    จุดที่สอง (`setAssignGroupIds`) ส่ง `next` ซึ่ง *คือ* ลิสต์กลุ่มใหม่อยู่แล้ว
   *    ⇒ เทสแดงทั้งที่โค้ดถูก · กติกาที่ต้องกันจริงคือ "ห้ามมีตัวเอกพจน์หลุดเข้ามา"
   *    ไม่ใช่ "ต้องสะกดแบบนี้" — เทสที่ผูกกับวิธีเขียน จะขวางการแก้ที่ถูกต้อง.
   */
  it('🔴 ไม่มีจุดไหนส่ง assign_group (เอกพจน์) เข้า pruneHookIds อีกแล้ว', async () => {
    const body = await import('node:fs').then(fs =>
      fs.readFileSync('components/campaign/BroadcastFormModal.tsx', 'utf8'),
    );
    const calls = body.match(/pruneHookIds\(prev\.hook_ids, hooks, \[[\s\S]{0,200}?\]\)/g) ?? [];
    /* [FEAT-2708-TARGETGROUPCUT] (งาน 5.4) เหลือจุดเดียว — `setTargetGroupIds`
       ถูกถอดพร้อม picker ของ step 5 · cascade ของกลุ่มเจ้าของงานยังอยู่ */
    expect(calls.length).toBe(1);
    for (const c of calls) {
      /* `prev.assign_group` ที่ไม่ตามด้วย `_ids` = กลับไปใช้กลุ่มเดียว */
      expect(c).not.toMatch(/prev\.assign_group(?!_ids)/);
    }
  });
});
