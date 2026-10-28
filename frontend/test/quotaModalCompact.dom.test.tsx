/**
 * [FIX-2708-QUOTAMODALFIT] (งาน 5.7) modal โควตาต้องสูงเท่าเนื้อหา ไม่ใช่ 86vh
 * ===========================================================================
 * เจ้าของ 27/08 พร้อม screenshot: กล่องโควตาสูงทั้งจอแต่เนื้อหามีการ์ดเดียว —
 * ที่ว่างล่างยาวเหยียด · ต้นเหตุ: เปลือก Modal **ล็อก** `h-[86vh]` โดยตั้งใจ
 * ([UI-20260825-LOCKHEIGHT] — ออกแบบให้ฟอร์มหลายแท็บสูงคงที่ ปุ่มไม่กระโดด)
 * ⇒ เหตุผลนั้นไม่ใช้กับกล่องเนื้อหาเดียวรูปตายตัว · ทางแก้: QuotaModal ส่ง
 * `panelClassName` ของตัวเอง (ช่องทางที่ Modal เปิดไว้ให้อยู่แล้ว) เป็น template
 * เดิม byte-copy แค่เปลี่ยน `h-[86vh]` → `max-h-[86vh]` — โมดัลอื่นไม่โดนแตะ
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const getHookQuota = vi.fn((..._a: unknown[]) =>
  Promise.resolve({
    quota: { type: 'limited', value: 300 },
    consumption: { totalUsage: 156 },
    remaining: 144,
  }),
);
vi.mock('../services/hook', () => ({
  webhookService: { getHookQuota: (...a: unknown[]) => getHookQuota(...a) },
}));

import { QuotaModal } from '../components/hook/quota/QuotaModal';

describe('[QUOTAMODALFIT] กล่องโควตาสูงตามเนื้อหา', () => {
  it('⭐⭐ panel ใช้ max-h ไม่ใช่ความสูงล็อก h-[86vh]', async () => {
    const { baseElement } = render(
      <QuotaModal isOpen onClose={() => {}} hookId="h1" oaName="demo-oa-three" />,
    );
    await waitFor(() => expect(getHookQuota).toHaveBeenCalled());
    const panel = Array.from(baseElement.querySelectorAll('div')).find((d) =>
      /rounded-2xl/.test(d.className),
    );
    expect(panel).toBeTruthy();
    expect(panel!.className).toContain('max-h-[86vh]');
    // 'max-h-[86vh]' มี 'h-[86vh]' เป็น substring — ต้องเช็คแบบ token
    const tokens = panel!.className.split(/\s+/);
    expect(tokens).not.toContain('h-[86vh]');
    // โครงเดิมที่ต้องคงไว้ให้ header/body/footer เรียงถูก
    expect(tokens).toContain('flex');
    expect(tokens).toContain('flex-col');
  });
});
