/**
 * [FIX-20260825-BCASTFLEXIDVALID] เลือกการ์ด flex แล้วฟอร์มยังฟ้อง "กรุณากรอกข้อความ"
 * ===========================================================================
 * เจ้าของแจ้ง 25/08 พร้อมภาพ: หน้า create broadcast เลือกประเภท **Flex Message**
 * จับการ์ดไว้แล้ว (จอขึ้น "ผูกกับการ์ด id: 6a8c6ae…") แต่ยังขึ้น
 * "⚠ กรุณากรอกข้อความ" ⇒ กดบันทึกไม่ผ่าน
 *
 * ต้นเหตุ: `BroadcastFormModal.tsx:261` ตรวจเฉพาะ `flexText` ซึ่งเป็นช่อง JSON ดิบ
 * แต่ [FEAT-20260824-BCASTFLEXID] เพิ่มทางที่สองคือ **ผูกด้วย `flex_id`** ซึ่งไม่ได้
 * กรอก JSON เลย ⇒ `flexText` ว่าง ⇒ ตกเงื่อนไข "ต้องกรอก"
 *
 * ⚠️ ฝั่งส่งค่าไม่ได้ผิด — `buildMessagePayload.ts:67` อ่าน `flex_id` ก่อนอยู่แล้ว
 *    และ BE ก็อ่าน flex_id ก่อน fallback flex_json ⇒ **ผิดที่ตัว validate ที่เดียว**
 *
 * กฎถูกแยกออกมาเป็นฟังก์ชันบริสุทธิ์ (แนวเดียวกับ campaignTime.ts ข้าง ๆ) เพราะ
 * `validate()` เดิมเป็น closure ในคอมโพเนนต์ 1,000+ บรรทัด ทดสอบตรงไม่ได้เลย
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMessage } from '../components/campaign/messageValidation';

describe('[BCASTFLEXIDVALID] flex — ผูกการ์ดด้วย id ต้องผ่าน ไม่ต้องกรอก JSON', () => {
  it('⭐⭐ เลือกการ์ดแล้ว (มี flex_id) + ไม่กรอก JSON = ผ่าน  ← บั๊กที่เจ้าของเจอ', () => {
    expect(
      validateMessage({ type: 'flex', flex_id: 'a0d000000000000000000095' }, ''),
    ).toBeNull();
  });

  it('⭐ flex_id ที่เป็นช่องว่างล้วน ไม่นับว่าผูก — ต้องยังฟ้อง', () => {
    expect(validateMessage({ type: 'flex', flex_id: '   ' }, '')).toBe('required');
  });

  it('⭐ ไม่มีทั้ง flex_id และ JSON = ฟ้องเหมือนเดิม (พฤติกรรมเดิมต้องไม่หาย)', () => {
    expect(validateMessage({ type: 'flex' }, '')).toBe('required');
  });

  it('⭐ ไม่มี flex_id แต่กรอก JSON ถูก = ผ่าน (ทางเดิมยังใช้ได้)', () => {
    expect(validateMessage({ type: 'flex' }, '{"type":"bubble"}')).toBeNull();
  });

  it('⭐ ไม่มี flex_id และ JSON เสีย = ฟ้องว่า JSON ผิด ไม่ใช่ "ต้องกรอก"', () => {
    expect(validateMessage({ type: 'flex' }, 'notidepwith')).toBe('flex_invalid');
  });

  /* ⚠️ ผูกการ์ดไว้แล้วแต่ดันมี JSON เสียค้างอยู่ในช่อง — ยังต้องฟ้อง
     ไม่งั้นคนแก้ JSON พังแล้วเผลอผูกการ์ด จะบันทึกทับของเสียไปเงียบ ๆ */
  it('⭐⭐ มี flex_id แต่ JSON ที่ค้างอยู่เสีย = ยังต้องฟ้อง', () => {
    expect(validateMessage({ type: 'flex', flex_id: 'abc' }, '{{{')).toBe('flex_invalid');
  });
});

describe('[BCASTFLEXIDVALID] text / image — พฤติกรรมเดิมห้ามขยับ (PIN)', () => {
  it('text ว่าง = ฟ้อง', () => {
    expect(validateMessage({ type: 'text', text: '  ' }, '')).toBe('required');
  });
  it('text มีค่า = ผ่าน', () => {
    expect(validateMessage({ type: 'text', text: 'สวัสดี' }, '')).toBeNull();
  });
  it('image ว่าง = ฟ้อง', () => {
    expect(validateMessage({ type: 'image', image_url: '' }, '')).toBe('required');
  });
  it('image ไม่ใช่ https = ฟ้อง https', () => {
    expect(validateMessage({ type: 'image', image_url: 'http://a/b.png' }, '')).toBe('image_https');
  });
  it('image https = ผ่าน', () => {
    expect(validateMessage({ type: 'image', image_url: 'https://a/b.png' }, '')).toBeNull();
  });
  /* flex_id ต้องไม่ช่วยอะไร text/image — ช่องนั้นไม่มีอยู่บนจอด้วยซ้ำ */
  it('⭐ flex_id ไม่ช่วย text ที่ว่าง', () => {
    expect(validateMessage({ type: 'text', text: '', flex_id: 'abc' }, '')).toBe('required');
  });
});

/* ⚠️ บทเรียนจากตอนแก้เอง 25/08: รอบแรกเขียน t(`broadcast.form_${problem}`)
   ซึ่งได้คีย์ `broadcast.form_required` — **ไม่มีอยู่จริง** (ของจริงคือ
   `form_message_required`) ⇒ จอจะขึ้นชื่อคีย์ดิบแทนข้อความไทย
   เทสกลุ่มนี้ผูก "รหัสเหตุผลทุกตัว" เข้ากับ "คีย์แปลที่มีจริงทั้ง 3 ภาษา" */
describe('[BCASTFLEXIDVALID] ทุกเหตุผลต้องมีคำแปลจริงครบทุกภาษา', () => {
  const REASONS = ['required', 'image_https', 'flex_invalid'] as const;
  const KEY: Record<(typeof REASONS)[number], string> = {
    required: 'broadcast.form_message_required',
    image_https: 'broadcast.form_image_https',
    flex_invalid: 'broadcast.form_flex_invalid',
  };

  it.each(['th', 'en', 'zh'])('%s มีคำแปลครบทุกเหตุผล', (locale) => {
    const dict = JSON.parse(
      readFileSync(join(process.cwd(), `i18n/translations/${locale}.json`), 'utf8'),
    ) as Record<string, string>;
    const missing = REASONS.map((r) => KEY[r]).filter((k) => !dict[k]);
    expect(missing).toEqual([]);
  });

  it('⭐ ฟอร์มใช้ map ตัวเดียวกันนี้จริง ไม่ได้ต่อสตริงเอา', () => {
    const src = readFileSync(
      join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
      'utf8',
    );
    expect(src).toContain('MESSAGE_PROBLEM_KEY');
    expect(src).toContain("required: 'broadcast.form_message_required'");
    // ต่อสตริงคือวิธีที่ทำให้คีย์หายไปเงียบ ๆ — ห้ามกลับไปใช้
    expect(src).not.toContain('broadcast.form_${');
  });
});
