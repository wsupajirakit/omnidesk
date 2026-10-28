/**
 * [FEAT-20260909-AITABVENDORSPLIT] แท็บ AI ขั้นสูง — ค่ายละกล่อง และทั้งสองกล่องโผล่ตลอด
 * ===========================================================================
 * เจ้าของ 09/09: *"ให้แบ่ง div deepseek + div gemini (ขึ้นบน) แบ่งให้แสดงตลอดเวลาเลย
 * แบ่งค่าใครค่ามันให้เข้าใจง่าย"*
 *
 * 🔴 ทำไมต้องมีไฟล์นี้ — เทสต์ที่มีอยู่แล้ว **ไม่มีตัวไหนเห็นคู่ของ DeepSeek เลย**
 *    ทั้ง 144 เคสในหกไฟล์ที่อ่านโซนนี้ (hookFormPayload · HookFormModal.value ·
 *    aiVendorSingleTruth · hookCloneAiVendor · BulkMethodModal · hookSlipProvider)
 *    ยังเขียวเป๊ะ ไม่ว่าจะมี `{isDeepSeek && …}` คลุมอยู่หรือไม่ — พิสูจน์ด้วยการกลาย
 *    พันธุ์แล้ว 09/09 · แปลว่าถ้าไม่เขียนไฟล์นี้ การถอดกติกาซ่อนออกจะ "ผ่าน" โดยไม่มี
 *    อะไรยืนยันว่าเกิดขึ้นจริง และวันที่มีคนใส่กลับเข้าไปก็จะไม่มีอะไรแดง
 *
 * เส้นทางไปถึงตัวควบคุมลึกสองชั้นเหมือนเทสต์ vendor เดิม:
 *   activeTab === 'ai' → aiSubTab === 'advanced' ("AI ขั้นสูง")
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── mock the network-touching services so mount effects settle cleanly ──
// (ชุดเดียวกับ HookFormModal.value.test.tsx — โมดัลตัวเดียวกัน เงื่อนไข mount เดียวกัน)
vi.mock('../services/media', () => ({ flexMessageService: { listFlexMessages: () => Promise.resolve([]) } }));
vi.mock('../services/admin/configService', () => ({ configService: { listConfigs: () => Promise.resolve([]) } }));
vi.mock('../services/chat/handoffService', () => ({ handoffService: { listTargets: () => Promise.resolve([]) } }));
vi.mock('../services/admin/groupService', () => ({ groupService: {
  listGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getVisibleGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroup: () => Promise.resolve({ _id: 'a0d00000000000000000001e', group_name: 'Group One' }),
} }));
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const data = [
    { id: 'pay-tool-1', name: 'Payment tool', category: 'payment', base_url: 'https://pay.test', endpoints: [] },
    { id: 'walletpay-tool-1', name: 'Walletpay tool', category: 'generic', base_url: 'https://walletpay.test', endpoints: [] },
  ];
  return {
    ...actual,
    customToolService: {
      listCustomTools: () => Promise.resolve({ data, pagination: { page: 1, limit: 200, total: data.length, pages: 1 } }),
      list: () => Promise.resolve({ data, pagination: {} }),
      getUsage: () => Promise.resolve({ count: 0, active: 0, hooks: [] }),
    },
  };
});
vi.mock('../services/apiClient', () => ({ API_BASE_URL: '', authFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }), handleApiResponse: () => Promise.resolve([]) }));
vi.mock('../services/authStorage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getAuthUser: () => ({ username: 'dev', role: 'superadmin', groups: [], permissions: ['system.manage'] }) };
});

import { HookFormModal } from '../components/hook';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (global as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (window.HTMLElement.prototype as any).showPicker = vi.fn();
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

/** hook ที่ผ่าน validate() ครบ เพื่อให้กด save แล้วถึง onSubmit จริง */
const validHook: any = {
  _id: 'h1', line_oa_name: 'OA One', alias: 'oa-alias', company_name: 'Company',
  description: 'desc', domain_name: 'example.com', line_url: 'https://line.me/x',
  webhook_url: 'https://example.com/wh', channel_id: 'CHAN1', channel_type: 'line',
  telegram_key: 'TG-KEY', telegram_chat_id: 'TG-CHAT', telegram_noti_type: 'all',
  channel_secret: 'secret123', access_token: 'token123',
  group_id: 'a0d00000000000000000001e', status: 1,
  suggestion_text: 'hello',
  default_answer_text: 'DEFAULT_ANSWER', missing_api_data_text: 'MISSING_API',
  image_answer_text: 'IMAGE_ANS', answer_link: 'https://example.com/a',
  status_off_action: 'silent', status_off_text: 'ปิดปรับปรุงชั่วคราว',
};

/** เปิดแท็บ AI แล้วเข้าแท็บย่อย "AI ขั้นสูง" ซึ่งเป็นที่อยู่ของกล่องทั้งสอง */
const openAdvanced = async (initialData: any, mode: 'update' | 'create' = 'update') => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <I18nProvider>
      <HookFormModal isOpen onClose={() => {}} onSubmit={onSubmit} initialData={initialData} mode={mode} />
    </I18nProvider>,
  );

  const tabBtn = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button'))
      .find(x => x.textContent?.includes('AI & Responses'));
    if (!b) throw new Error('AI tab not mounted yet');
    return b;
  });
  fireEvent.click(tabBtn);

  const subTabBtn = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button'))
      .find(x => x.textContent?.includes('AI ขั้นสูง'));
    if (!b) throw new Error('advanced sub-tab not mounted yet');
    return b;
  });
  fireEvent.click(subTabBtn);

  // รอให้ช่องแรกของกล่อง Gemini ขึ้นก่อน แล้วค่อยอ่านอย่างอื่น
  await waitFor(() => {
    if (!container.querySelector('select[name="ai_vendor"]')) {
      throw new Error('advanced pane not mounted yet');
    }
  });
  return { container, onSubmit };
};

const gemBox = (c: HTMLElement) => c.querySelector('[data-testid="ai-vendor-box-gemini"]') as HTMLElement | null;
const deepBox = (c: HTMLElement) => c.querySelector('[data-testid="ai-vendor-box-deepseek"]') as HTMLElement | null;

const save = async (container: HTMLElement, onSubmit: ReturnType<typeof vi.fn>) => {
  const btn = await waitFor(() => {
    const b = container.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (!b) throw new Error('submit button not mounted yet');
    return b;
  });
  fireEvent.click(btn);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
  return onSubmit.mock.calls[0][0] as Record<string, unknown>;
};

describe('[AITABVENDORSPLIT] ค่ายละกล่อง — ทั้งสองกล่องโผล่ตลอดเวลา', () => {
  it('⭐⭐ 🔴 เลือก gemini อยู่ ก็ยังต้องเห็นช่องของ DeepSeek ครบทั้งคู่', async () => {
    /* นี่คือเคสที่ฟีเจอร์ทั้งหมดมีอยู่เพื่อมัน: หลัก = gemini แต่ต้องกรอกคีย์ DeepSeek
       ไว้ให้เส้นแปลภาษาใช้ · ของเดิมซ่อนสองช่องนี้ตาม ai_vendor ⇒ ไม่มีที่ให้วางคีย์
       ⚠️ เคสนี้คือตัวที่ตายเมื่อเอา `{isDeepSeek && …}` กลับเข้าไป (ยืนยันแล้ว 09/09) */
    const { container } = await openAdvanced({ ...validHook, ai_vendor: 'gemini' });

    expect((container.querySelector('select[name="ai_vendor"]') as HTMLSelectElement).value).toBe('gemini');
    expect(container.querySelector('input[name="ai_model_sec"]')).toBeTruthy();
    expect(container.querySelector('input[name="custom_ai_key_sec"]')).toBeTruthy();
  });

  it('⭐⭐ 🔴 ไม่ได้เลือกค่ายอะไรเลย (ใช้ค่าเริ่มต้น) ก็ยังเห็นทั้งสองกล่อง', async () => {
    // ค่าว่าง = "ใช้ค่าเริ่มต้น" ซึ่งเป็นสถานะของ hook ส่วนใหญ่ที่ไม่เคยแตะแท็บนี้
    const { container } = await openAdvanced(validHook);

    expect(gemBox(container)).toBeTruthy();
    expect(deepBox(container)).toBeTruthy();
    expect(container.querySelector('input[name="custom_ai_key_sec"]')).toBeTruthy();
  });

  it('⭐ Gemini อยู่บน DeepSeek อยู่ล่าง ตามที่เจ้าของสั่ง', async () => {
    const { container } = await openAdvanced(validHook);
    const order = gemBox(container)!.compareDocumentPosition(deepBox(container)!);
    // eslint-disable-next-line no-bitwise
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('⭐ ค่าใครค่ามัน — ai_model + custom_ai_key อยู่ในกล่อง Gemini, คู่ _sec อยู่ในกล่อง DeepSeek', async () => {
    /* ถ้าไม่ผูกว่า "อยู่ในกล่องไหน" เทสต์ข้างบนจะยังเขียวแม้ทุกช่องกองรวมกันเหมือนเดิม
       — ซึ่งคือจอที่เจ้าของบอกว่าอ่านไม่รู้เรื่อง */
    const { container } = await openAdvanced(validHook);
    const g = gemBox(container)!;
    const d = deepBox(container)!;

    expect(g.querySelector('input[name="ai_model"]')).toBeTruthy();
    expect(g.querySelector('input[name="custom_ai_key"]')).toBeTruthy();
    expect(g.querySelector('input[name="custom_ai_key_sec"]')).toBeNull();

    expect(d.querySelector('input[name="ai_model_sec"]')).toBeTruthy();
    expect(d.querySelector('input[name="custom_ai_key_sec"]')).toBeTruthy();
    expect(d.querySelector('input[name="custom_ai_key"]')).toBeNull();
  });

  it('⭐⭐ 🔴 ปุ่มล็อกความลับย้ายมาพร้อม custom_ai_key — ไม่ได้หล่นหายตอนย้ายไฟล์', async () => {
    /* [FEAT-20260817-SECRETLOCK] ช่องนี้เคยลบคีย์จริงของ OA มาแล้วตอนที่กล่องแก้ไขได้
       พร้อม placeholder · การย้ายบล็อกข้ามไฟล์แล้วพิมพ์ใหม่ด้วยมือคือวิธีที่ปุ่มล็อก
       จะหายไปเงียบ ๆ ⇒ ผูกไว้ว่ามันต้องอยู่ "ในกล่อง Gemini" ที่มันย้ายไปอยู่ */
    const { container } = await openAdvanced({ ...validHook, custom_ai_key: 'AIza-REAL' });
    const g = gemBox(container)!;

    const key = g.querySelector('input[name="custom_ai_key"]') as HTMLInputElement;
    // มีค่าเก็บอยู่ ⇒ ต้องเปิดมาแบบล็อก อ่านอย่างเดียว และโชว์จุดไข่ปลาแทนคีย์จริง
    expect(key.readOnly).toBe(true);
    expect(key.value).not.toBe('AIza-REAL');
    // ปุ่ม "แก้ไข" ต้องอยู่ใน div เดียวกับ input ไม่ใช่แค่ที่ไหนสักแห่งในฟอร์ม
    expect(g.querySelector('[data-testid="secret-edit-custom_ai_key"]')).toBeTruthy();
    // ไอคอนตาสองฝั่ง (pl-10/pr-10) ก็ต้องมาด้วย — ปุ่มในกรอบเดียวกับ input
    expect(key.parentElement!.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
  });

  it('⭐⭐ 🔴 โผล่ ≠ เขียน — กล่อง DeepSeek ที่ไม่ได้ถูกพิมพ์ ต้องไม่ส่งอะไรเลย', async () => {
    /* กติกาที่ห้ามพังที่สุดในงานนี้ · "ซ่อน ≠ ลบ" เดิมกลายเป็น "โผล่ ≠ เขียน":
       hook ที่เลือก gemini แล้วเปิดแท็บมาดูเฉย ๆ ต้องยิง payload ว่างเหมือนเดิม
       ไม่ใช่ยัด ai_model_sec: null / custom_ai_key_sec: '' ไปทับของที่มีอยู่ในฐาน */
    const { container, onSubmit } = await openAdvanced({
      ...validHook,
      ai_vendor: 'gemini',
      ai_model_sec: 'deepseek-reasoner',
      custom_ai_key_sec: 'sk-REAL',
    });
    expect(container.querySelector('input[name="custom_ai_key_sec"]')).toBeTruthy();

    const payload = await save(container, onSubmit);
    expect(payload).not.toHaveProperty('custom_ai_key_sec');
    expect(payload).not.toHaveProperty('ai_model_sec');
    expect(payload).not.toHaveProperty('custom_ai_key');
    expect(payload).not.toHaveProperty('ai_vendor');
  });

  it('⭐ พิมพ์ในกล่อง DeepSeek ทั้งที่เลือก gemini อยู่ แล้วค่าไปถึง payload จริง', async () => {
    /* คู่ตรงข้ามของเคสข้างบน — ไม่มีเคสนี้ "ไม่ส่งอะไรเลย" จะเขียวได้ด้วยการที่ช่อง
       นั้นไม่ได้ผูกกับฟอร์มเลย ซึ่งคือช่องที่พิมพ์แล้วหาย */
    const { container, onSubmit } = await openAdvanced({ ...validHook, ai_vendor: 'gemini' });
    const model = container.querySelector('input[name="ai_model_sec"]') as HTMLInputElement;
    fireEvent.change(model, { target: { name: 'ai_model_sec', value: 'deepseek-chat' } });

    const payload = await save(container, onSubmit);
    expect(payload.ai_model_sec).toBe('deepseek-chat');
  });

  it('⭐ 🔴 โมเดลของ DeepSeek (ai_model_sec) จาก initialData ต้องโชว์ใน input ไม่เป็นค่าว่าง', async () => {
    const { container } = await openAdvanced({
      ...validHook,
      ai_vendor: 'deepseek',
      ai_model_sec: 'deepseek-v4-flash',
    });
    const model = container.querySelector('input[name="ai_model_sec"]') as HTMLInputElement;
    expect(model).toBeTruthy();
    expect(model.value).toBe('deepseek-v4-flash');
  });
});

/**
 * [FEAT-20260909-AITABVENDORSPLIT] The boxes fold, and folding is not hiding.
 *
 * 🔴 THE DISTINCTION IS THE WHOLE TEST. The DeepSeek box stopped being
 *    conditional because a hidden box left nowhere to paste a DeepSeek key.
 *    A collapse that UNMOUNTED its children would walk straight back into that:
 *    a value typed, the box folded, the value gone — and a validation error
 *    inside a folded box would point at a field that is not in the document.
 *    So collapsed is CSS, and these cases are what keep it CSS.
 */
describe('[AITABVENDORSPLIT] the vendor boxes collapse without losing anything', () => {
  it('⭐ C1 · both boxes start OPEN — an operator must see what is there first', async () => {
    const { container } = await openAdvanced(validHook);
    for (const id of ['ai-vendor-box-gemini', 'ai-vendor-box-deepseek']) {
      const box = container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      expect(box.querySelector('button[aria-expanded="true"]')).toBeTruthy();
    }
  });

  it('⭐ C2 · folding keeps the fields IN THE DOM — collapsed is css, not unmounted', async () => {
    const { container } = await openAdvanced(validHook);
    const box = container.querySelector(
      '[data-testid="ai-vendor-box-deepseek"]',
    ) as HTMLElement;
    const before = box.querySelectorAll('input, select').length;
    expect(before).toBeGreaterThan(0);

    fireEvent.click(box.querySelector('button[aria-expanded]') as HTMLElement);

    expect(box.querySelector('button[aria-expanded="false"]')).toBeTruthy();
    /* Same count after folding. A `&&` would make this 0 and take the operator's
       unsaved input with it. */
    expect(box.querySelectorAll('input, select').length).toBe(before);
  });

  it('⭐ C3 · Gemini owns the generation knobs now — they moved out of the tab body', async () => {
    /* They are Gemini values: DeepSeek has no top_k at all and its transport
       logs the knob as ignored. Asserting WHICH box they are in is what stops
       them drifting back to a row that sits under both vendors. */
    const { container } = await openAdvanced(validHook);
    const gem = container.querySelector(
      '[data-testid="ai-vendor-box-gemini"]',
    ) as HTMLElement;
    const deep = container.querySelector(
      '[data-testid="ai-vendor-box-deepseek"]',
    ) as HTMLElement;
    for (const name of ['gemini_temperature', 'gemini_top_k', 'gemini_top_p']) {
      expect({ name, inGemini: !!gem.querySelector(`[name="${name}"]`) }).toEqual({
        name,
        inGemini: true,
      });
      expect(deep.querySelector(`[name="${name}"]`)).toBeNull();
    }
  });

  it('⭐ C4 · the whole header strip is the button — not just the chevron', async () => {
    /* Owner, 09/09: "กดตรงไหนก็ได้ของแท็บ ไม่ใช่เล็งแค่ arrow".
       jsdom has no layout, so this cannot measure pixels. What it CAN pin is the
       structure that made the strip dead: the card must not carry its own
       padding, because that padding framed the button and looked clickable
       while doing nothing. The padding belongs ON the button and on the body. */
    const { container } = await openAdvanced(validHook);
    for (const id of ['ai-vendor-box-gemini', 'ai-vendor-box-deepseek']) {
      const box = container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const btn = box.querySelector('button[aria-expanded]') as HTMLElement;

      /* the button is a DIRECT child of the card — nothing padded in between */
      expect(btn.parentElement).toBe(box);
      /* it spans the width and carries the padding itself */
      expect(btn.className).toContain('w-full');
      expect(btn.className).toMatch(/px-\d/);
      /* and the card does not, or the strip gets a dead frame again */
      expect({ id, cardPadded: /\bp-\d/.test(box.className) }).toEqual({
        id,
        cardPadded: false,
      });
    }
  });

  it('C5 · clicking the TITLE toggles, not only the chevron', async () => {
    const { container } = await openAdvanced(validHook);
    const box = container.querySelector(
      '[data-testid="ai-vendor-box-gemini"]',
    ) as HTMLElement;
    const btn = box.querySelector('button[aria-expanded]') as HTMLElement;
    fireEvent.click(btn.querySelector('span') as HTMLElement);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});
