/**
 * [FIX-20260824-PICKERSAME] ทุกช่องเลือกในหน้าบรอดแคสต์ต้องเป็นแบบเดียวกัน
 * ===========================================================================
 * เจ้าของ 24/08:
 *   · *"บางอันมี select search อันไม่มี อะไรวะ มั่วมาก"* / *"รวมกันสิ ใน page boardcast"*
 *   · *"ui group ติ๊กกี่ตั๊กก็ได้ / hook จะติ๊กกี่ตัวก็ได้ (ถ้าติ๊ก group แม่ออก hook ลูกต้องออกตาม)"*
 *   · *"select option อย่าลืม เลือกทั้งหมดได้ ยกเลิก ได้"*
 *   · *"ปุ่มยืนยัน ยกเลิก เพิ่มที่ header ด้วย"*
 *
 * 🔴 ทำไมต้องขับผ่านฟอร์มจริง ไม่ใช่ mount `MultiCheckSelect` เดี่ยว ๆ — ของที่พัง
 *    อยู่คือ **การต่อสาย**: ตัวเลือก OA ถูกล็อกไว้จนกว่าจะเลือกกลุ่มเจ้าของงาน และ
 *    การตัด OA ตามกลุ่มเกิดขึ้นใน handler ของฟอร์ม ไม่ใช่ในตัว component
 *    ⇒ เทสที่ mount component เดี่ยวจะเขียวสนิททั้งที่หน้าจอยังใช้ไม่ได้
 *
 * ⚠️ `waitFor` ทุกครั้งที่แตะกลุ่ม เพราะรายชื่อ OA โหลดใหม่แบบ async ทุกครั้งที่
 *    ชุดกลุ่มที่ติ๊กเปลี่ยน (`groupPickKey`)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const GROUPS = [
  { _id: 'g1', group_name: 'Alpha Group' },
  { _id: 'g2', group_name: 'Bravo Group' },
];

/* หนึ่ง OA อยู่ได้กลุ่มเดียว (`types/hook.ts:5` — ฟิลด์ `group`) การตัดตามกลุ่ม
   จึงอ่านจากฟิลด์นี้ ไม่ใช่เดาจากลำดับที่โหลดมา */
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
  webhookService: {
    getHooksByGroup: (id: string) => Promise.resolve(HOOKS[id] ?? []),
  },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve(GROUPS),
  /* I18nProvider อ่านภาษาจาก preferences ตอน mount — โมดูลเดียวกับ
     fetchVisibleGroups จึงต้อง stub ให้ครบ ไม่งั้น provider พังตั้งแต่ render แรก */
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
/* [FEAT-20260825-BCASTFOLD] การ์ดพับเป็นค่าเริ่มต้นตั้งแต่ 25/08 ⇒ กางก่อนทดสอบ
   ดูเหตุผลที่ `openAllFormSections` ใน test/setup.ts */
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const onClose = vi.fn();
const onSubmit = vi.fn(() => Promise.resolve());

beforeEach(() => {
  onClose.mockClear();
  onSubmit.mockClear();
});

const open = (mode: 'create' | 'view' = 'create') =>
  {
    const r = render(
    <I18nProvider>
      <BroadcastFormModal isOpen onClose={onClose} onSubmit={onSubmit} mode={mode} />
    </I18nProvider>,
    );
    openAllFormSections(r.container as HTMLElement);
    return r;
  }

const q = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/**
 * เปิดเมนูของตัวเลือกหลายค่า แล้วคืนกล่องเมนูมาให้
 * ⚠️ ปุ่ม trigger เป็น **toggle** — ถ้าเมนูเปิดค้างอยู่แล้วกดซ้ำจะกลายเป็นปิด
 *    (รอบแรกของไฟล์นี้ตกด้วยเหตุนี้) ⇒ เช็คก่อนว่าเปิดอยู่หรือยัง
 */
const openMenu = async (c: HTMLElement, picker: string) => {
  if (!q(c, `${picker}-menu`)) fireEvent.click(q(c, `${picker}-trigger`) as HTMLElement);
  return await waitFor(() => {
    const menu = q(c, `${picker}-menu`);
    expect(menu).not.toBeNull();
    return menu as HTMLElement;
  });
};

/* [FEAT-2708-GRIDPICK] (งาน 5.3) assign-group / hook-picker เปลี่ยนเป็นตาราง
   กางตลอด — ไม่มี trigger/menu/count ให้เปิด/อ่านอีก · helper คู่ล่างนี้คือ
   ร่าง grid: กล่อง render อยู่เสมอ และ "จำนวนที่เลือก" อ่านจาก checkbox ตรง ๆ */
const gridOf = async (c: HTMLElement, picker: string) =>
  await waitFor(() => {
    const g = q(c, picker);
    expect(g).not.toBeNull();
    return g as HTMLElement;
  });
const checkedIn = (c: HTMLElement, picker: string) =>
  (q(c, picker) as HTMLElement).querySelectorAll('input[type="checkbox"]:checked').length;

/** ปิดเมนูด้วยปุ่ม "ตกลง" ของมันเอง */
const closeMenu = (c: HTMLElement, picker: string) => {
  const done = q(c, `${picker}-done`);
  if (done) fireEvent.click(done);
};

const countOf = (c: HTMLElement, picker: string) => q(c, `${picker}-count`)?.textContent;

describe('[FIX-20260824-PICKERSAME] ช่องเลือกทุกช่องค้นหาได้เหมือนกันหมด', () => {
  it('⭐ "กลุ่มเว็บ" (assign_group) มีช่องค้นหา — เมื่อก่อนเป็น <select> เปล่า', async () => {
    const view = open();
    const box = await waitFor(() => {
      const el = q(view.container, 'assign-group-picker');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    /* [GRIDPICK] ตารางกางตลอด — ช่องค้นหาโผล่ตั้งแต่แรก ไม่ต้องกดอะไร */
    await waitFor(() =>
      expect(q(view.container, 'assign-group-search')).not.toBeNull(),
    );
    expect(box.querySelector('input[type="text"]')).not.toBeNull();
  });

  /**
   * [FEAT-20260825-MULTIGROUP] เคสนี้เคยยืนยันสิ่งที่ **ตรงกันข้าม**
   *
   * ของเดิมชื่อ *"assign_group ยังเป็นค่าเดียว ห้ามกลายเป็นติ๊กหลายค่า"* และเช็คว่า
   * ต้องไม่มี checkbox ในกล่องนี้ — เขียนไว้ตอนที่ BE รับได้กลุ่มเดียวจริง ๆ
   *
   * 25/08 เจ้าของสั่ง *"กลุ่มเว็บต้อง multi check เลือกได้หลายกลุ่ม fe be รองรับ
   * ทำงานจริง"* และ BE เพิ่ม `assign_group_ids` รองรับแล้ว ⇒ กติกากลับด้าน
   * เขียนไว้แทนที่จะลบ เพื่อให้คนอ่านทีหลังรู้ว่ามันเปลี่ยนโดยมติ ไม่ใช่มีคนแอบแก้เทส
   *
   * 🔴 ยังต้องมีเทสตรงนี้อยู่ เพราะสิ่งที่ต้องกันเปลี่ยนไปเป็น "ต้องติ๊กได้หลายกลุ่มจริง"
   *    ถ้าวันหนึ่งมีคนเปลี่ยนกลับเป็นช่องเดี่ยว เทสนี้จะแดง
   */
  it('🔴 assign_group ติ๊กได้หลายกลุ่ม (กลับด้านจากกติกาเดิม 24/08)', async () => {
    const view = open();
    const box = await waitFor(() => q(view.container, 'assign-group-picker') as HTMLElement);
    /* [GRIDPICK] checkbox โผล่เองในตาราง — ไม่ต้องกดเปิดอะไรก่อน */
    await waitFor(() =>
      expect(box.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0),
    );
  });

  it('🔴 ติ๊กสองกลุ่มแล้วอยู่ครบทั้งคู่ — ไม่ใช่ตัวหลังทับตัวแรก', async () => {
    const view = open();
    const box = await waitFor(() => q(view.container, 'assign-group-picker') as HTMLElement);
    await waitFor(() =>
      expect(box.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2),
    );
    const boxes = Array.from(
      box.querySelectorAll('input[type="checkbox"]')
    ) as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    await waitFor(() => {
      const checked = Array.from(
        box.querySelectorAll('input[type="checkbox"]')
      ).filter(el => (el as HTMLInputElement).checked);
      expect(checked.length).toBe(2);
    });
  });

  it('⭐ "LINE OA" มีช่องค้นหา และกรองรายการจริง', async () => {
    const view = open();
    /* [GRIDPICK] ตาราง OA กางตลอด — ช่องค้นหาอยู่ตั้งแต่แรกแม้ยังไม่ติ๊กกลุ่ม */
    const grid = await gridOf(view.container, 'hook-picker');
    expect(q(view.container, 'hook-picker-search')).not.toBeNull();
    expect(grid).not.toBeNull();
  });
});

describe('[FIX-20260824-PICKERSAME] ตัวเลือก OA ต้องกดได้โดยไม่ต้องเลือกกลุ่มเจ้าของงานก่อน', () => {
  it('🔴 ปุ่มเปิดรายชื่อ OA ต้องไม่ถูกล็อกไว้ด้วย assign_group', async () => {
    /* คอมเมนต์ [FIX-20260824-HOOKSFROMGROUPS] ในฟอร์มบอกว่า "การล็อกคือตัวบั๊ก"
       และแก้ด้วยการโหลด OA จากทุกกลุ่มที่ติ๊ก — แต่ `disabled` ยังค้างอยู่ในโค้ดจริง
       ⇒ เจ้าของยัง "หา select hook ไม่เจอ" เหมือนเดิม เทสนี้กันไม่ให้มันกลับมา */
    const view = open();
    /* [GRIDPICK] ไม่มี trigger แล้ว — "ไม่ถูกล็อก" วัดที่ช่องค้นหาของตาราง OA
       ต้องกดพิมพ์ได้ทั้งที่ยังไม่เลือกกลุ่มเจ้าของงาน */
    const search = await waitFor(() => {
      const el = q(view.container, 'hook-picker-search') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(search.disabled).toBe(false);
  });

  it('⭐ โหมดดูอย่างเดียวยังล็อกอยู่ตามเดิม', async () => {
    const view = open('view');
    const search = await waitFor(() => {
      const el = q(view.container, 'hook-picker-search') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(search.disabled).toBe(true);
  });
});

describe('[FIX-20260824-PICKERSAME] เลือกทั้งหมด / ล้างทั้งหมด', () => {
  /* [FEAT-2708-TARGETGROUPCUT] (งาน 5.4) picker "เลือกตามกลุ่มเครือข่าย" ถูกตัด —
     หน้าที่ของมันย้ายไป step 3 (grid กลุ่มเว็บ) เคสนี้จึงชี้ไปที่นั่นแทน */
  it('⭐ กลุ่มเว็บ (step 3): เลือกทั้งหมดแล้วยกเลิก', async () => {
    const view = open();
    await gridOf(view.container, 'assign-group');
    await waitFor(() =>
      expect((q(view.container, 'assign-group') as HTMLElement).querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2),
    );
    fireEvent.click(q(view.container, 'assign-group-select-all') as HTMLElement);
    await waitFor(() => expect(checkedIn(view.container, 'assign-group')).toBe(2));
    fireEvent.click(q(view.container, 'assign-group-clear') as HTMLElement);
    await waitFor(() => expect(checkedIn(view.container, 'assign-group')).toBe(0));
  });

  it('⭐ LINE OA: ติ๊กกี่ตัวก็ได้ — เลือกทั้งหมดได้ทั้งสองกลุ่มพร้อมกัน', async () => {
    const view = open();
    await gridOf(view.container, 'assign-group');
    await waitFor(() =>
      expect((q(view.container, 'assign-group') as HTMLElement).querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2),
    );
    fireEvent.click(q(view.container, 'assign-group-select-all') as HTMLElement);

    /* OA จากทั้งสองกลุ่มต้องมารวมกันเป็นชุดเดียว ก่อนจะกดเลือกทั้งหมดได้ */
    await gridOf(view.container, 'hook-picker');
    await waitFor(() =>
      expect(q(view.container, 'hook-picker-opt-h2')).not.toBeNull(),
    );
    fireEvent.click(q(view.container, 'hook-picker-select-all') as HTMLElement);
    await waitFor(() => expect(checkedIn(view.container, 'hook-picker')).toBe(2));
  });

  it('🔴 "เลือกทั้งหมด" ตอนที่ค้นหาอยู่ = เลือกเฉพาะที่เห็น', async () => {
    /* ถ้าไปติ๊กแถวที่ถูกกรองออกไปด้วย แอดมินจะยิงหาคนที่ไม่เคยเห็นชื่อบนจอ
       และมองยังไงก็ไม่รู้ตัว — ความผิดพลาดชนิดที่ย้อนกลับไม่ได้
       [TARGETGROUPCUT] ชี้ที่ grid step 3 แทน picker ที่ถูกตัด — สัญญาเดียวกัน */
    const view = open();
    await gridOf(view.container, 'assign-group');
    await waitFor(() =>
      expect(q(view.container, 'assign-group-opt-g1')).not.toBeNull(),
    );
    fireEvent.change(q(view.container, 'assign-group-search') as HTMLInputElement, {
      target: { value: 'Bravo' },
    });
    await waitFor(() => expect(q(view.container, 'assign-group-opt-g1')).toBeNull());
    fireEvent.click(q(view.container, 'assign-group-select-all') as HTMLElement);
    fireEvent.change(q(view.container, 'assign-group-search') as HTMLInputElement, {
      target: { value: '' },
    });
    await waitFor(() => expect(checkedIn(view.container, 'assign-group')).toBe(1));
  });
});

describe('[FIX-20260824-HOOKCASCADE] ติ๊กกลุ่มออก ⇒ OA ของกลุ่มนั้นต้องออกตาม', () => {
  it('🔴 เอากลุ่ม Bravo ออก แล้ว OA Bravo ต้องหลุดจาก hook_ids ด้วย', async () => {
    const view = open();
    await gridOf(view.container, 'assign-group');
    await waitFor(() =>
      expect((q(view.container, 'assign-group') as HTMLElement).querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2),
    );
    fireEvent.click(q(view.container, 'assign-group-select-all') as HTMLElement);
    await waitFor(() => expect(checkedIn(view.container, 'assign-group')).toBe(2));

    await gridOf(view.container, 'hook-picker');
    await waitFor(() => expect(q(view.container, 'hook-picker-opt-h2')).not.toBeNull());
    fireEvent.click(q(view.container, 'hook-picker-select-all') as HTMLElement);
    await waitFor(() => expect(checkedIn(view.container, 'hook-picker')).toBe(2));

    /* ตาราง grid ไม่มีเมนูให้ปิด — เอากลุ่ม Bravo ออกตรง ๆ */
    fireEvent.click(q(view.container, 'assign-group-opt-g2') as HTMLElement);

    /* ⚠️ ของเดิมค่านี้ค้างที่ 2 ตลอด — OA Bravo หายจากจอแต่ยังขึ้น payload */
    await waitFor(() => expect(checkedIn(view.container, 'hook-picker')).toBe(1));
  });
});

describe('[UI-20260824-BCASTHEADERACT] ปุ่มยืนยัน/ยกเลิก อยู่ที่ header ด้วย', () => {
  it('⭐ header มีทั้งยืนยันและยกเลิก และปุ่มล่างยังอยู่ครบ', async () => {
    const view = open();
    const header = view.container.querySelector('button[name="header_confirm"]');
    expect(header).not.toBeNull();
    expect(view.container.querySelector('button[name="header_cancel"]')).not.toBeNull();

    /* 🔴 ปุ่มยืนยันของ header อยู่ **นอก** <form> — ต่อกันได้ด้วย form= เท่านั้น
       ถ้าลืม attribute นี้ ปุ่มจะกดแล้วเงียบสนิท */
    expect((header as HTMLButtonElement).getAttribute('form')).toBe('broadcast-form');
    expect(view.container.querySelector('form#broadcast-form')).not.toBeNull();

    /* "เพิ่มที่ header ด้วย" ไม่ใช่ "ย้ายไป header" — ปุ่มล่างต้องยังอยู่ */
    const submits = view.container.querySelectorAll('button[type="submit"]');
    expect(submits.length).toBe(2);
  });

  it('⭐ ยกเลิกที่ header ปิดฟอร์มจริง', async () => {
    const view = open();
    fireEvent.click(view.container.querySelector('button[name="header_cancel"]') as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('⭐ โหมดดูอย่างเดียวไม่มีปุ่มยืนยันที่ header', async () => {
    const view = open('view');
    expect(view.container.querySelector('button[name="header_confirm"]')).toBeNull();
    expect(view.container.querySelector('button[name="header_cancel"]')).not.toBeNull();
  });
});
