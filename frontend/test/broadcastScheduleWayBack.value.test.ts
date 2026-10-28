/**
 * [FIX-20260825-SCHEDULEWAYBACK] "form ไม่เซฟ กด edit แล้วต้องมาแก้ไขใหม่ทุกครั้ง"
 *
 * เจ้าของแจ้ง 25/08 · เป็นกับดัก dev-local §5 เป๊ะ ๆ: **ขาไปถูกหมด ขากลับตกหาย**
 *
 * ไล่ครบทุกชั้นแล้ว ผิดที่เดียว:
 *   ฟอร์มส่ง `schedule` ขึ้นไป  ✅ (`buildPayload`)
 *   BE DTO รับ                 ✅ (`broadcast.dto.ts:250,361`)
 *   schema เก็บ                ✅ (`broadcast.schema.ts:401`)
 *   read service ไม่มี projection ✅ (ของมาถึง FE แล้วจริง)
 *   FE normalizer คืนกลับ       ❌ ← ตกหายตรงนี้
 *
 * ⇒ เปิด edit มารอบส่งซ้ำว่าง และการเซฟครั้งถัดไป **ทับของจริงด้วย null**
 *   ผู้ใช้เห็นเป็น "มันไม่เซฟ" ทั้งที่เซฟแล้วและถูกล้างทีหลัง
 *
 * ⚠️ ไฟล์ normalizer เตือนกับดักนี้ไว้ถึง 3 จุด แต่ `schedule` ก็ยังหลุด
 *    เทสนี้จึงตรึง **ทุกคีย์ที่ฟอร์มส่งขึ้น** ไม่ใช่แค่ `schedule` ตัวเดียว
 */
import { describe, it, expect } from 'vitest';
import { normalizeBroadcast } from '../services/messaging/broadcastService';

const ROW = {
  _id: 'b1',
  name: 'แคมเปญ',
  description: 'ทำไม',
  status: 'scheduled',
  scheduled_at: '2026-08-25T02:00:00.000Z',
  send_kind: 'multicast',
  card_type: 'plain',
  title_detail: 'หัวข้อ',
  target: { mode: 'all', group_ids: [], match: 'or', rules: [{ key: 'k', op: 'lte', value: 'v' }] },
  message: { type: 'flex', flex_id: 'f1' },
  assign_group_ids: ['g1', 'g2'],
  hook_ids: ['h1'],
  schedule: {
    mode: 'repeat',
    enabled: true,
    at_time_min: 540,
    tz_offset_min: 420,
    days: [1, 3, 5],
    max_runs: 10,
  },
};

describe('[SCHEDULEWAYBACK] ค่าที่ตั้งไว้ต้องกลับมาครบตอนเปิด edit', () => {
  it('⭐⭐ `schedule` ต้องรอดกลับมา ไม่ใช่ null', () => {
    const n = normalizeBroadcast(ROW as never) as unknown as Record<string, unknown>;
    expect(n.schedule).not.toBeNull();
    expect(n.schedule).toEqual(ROW.schedule);
  });

  it('⭐⭐ ทุกฟิลด์ของรอบส่งซ้ำต้องครบ ไม่ใช่แค่มี object เปล่า', () => {
    const s = (normalizeBroadcast(ROW as never) as any).schedule;
    expect(s.mode).toBe('repeat');
    expect(s.enabled).toBe(true);
    expect(s.at_time_min).toBe(540);   // 09:00 เวลาไทย
    expect(s.tz_offset_min).toBe(420);
    expect(s.days).toEqual([1, 3, 5]);
    expect(s.max_runs).toBe(10);
  });

  /* ⭐ ตรึงทั้งชุด — บรรทัดที่หายไปหนึ่งบรรทัดคือบั๊กนี้ทั้งดุ้น
     ถ้ามีใครเพิ่มคอลัมน์ใหม่แล้วลืมใส่ใน normalizer ข้อนี้จะจับได้ */
  it('⭐⭐ ทุกคีย์ที่ฟอร์มใช้ ต้องเดินทางกลับมาครบ', () => {
    const n = normalizeBroadcast(ROW as never) as unknown as Record<string, unknown>;
    for (const k of [
      'name', 'description', 'status', 'scheduled_at', 'send_kind', 'card_type',
      'title_detail', 'target', 'message', 'assign_group_ids', 'hook_ids', 'schedule',
    ]) {
      expect(n[k], `คีย์ "${k}" ตกหายระหว่างทางกลับ`).not.toBeUndefined();
    }
  });

  it('⭐ แถวเก่าที่ไม่มี schedule = null ไม่ใช่ undefined (ฟอร์มอ่านได้เหมือนเดิม)', () => {
    const { schedule: _drop, ...old } = ROW as Record<string, unknown>;
    expect((normalizeBroadcast(old as never) as any).schedule).toBeNull();
  });
});

/* [FIX-20260825-CREATEENVELOPE] "ส่งทันที" ไม่เคยยิงจริง เพราะ id หายตอนแกะคำตอบ
   BE คืนรูปไม่เหมือนกันตามสถานะ: `status: 'sent'` ได้ `{data, results}` (ห่อซอง)
   ส่วนกรณีอื่นได้ตัว document ตรง ๆ · FE normalise ทั้งซอง ⇒ `id` เป็น ''
   ⇒ เงื่อนไข `if (status === 'sent' && savedId)` เป็นเท็จ ⇒ POST /:id/send ไม่ยิง
   วัดจริงจาก log 25/08: create มี · /send ไม่มี · broadcasts_histories ว่าง */
describe('[CREATEENVELOPE] id ต้องรอดทั้งสองรูปคำตอบ', () => {
  it('⭐⭐ คำตอบแบบห่อซอง (ตอน status sent) ต้องยังได้ id', () => {
    const enveloped = { data: { ...ROW }, results: [] };
    const n = normalizeBroadcast((enveloped as any).data ?? enveloped) as any;
    expect(n.id).toBe('b1');
  });

  it('⭐ คำตอบแบบไม่ห่อ (กรณีอื่น) ต้องยังได้ id เหมือนเดิม (PIN)', () => {
    const n = normalizeBroadcast((ROW as any).data ?? ROW) as any;
    expect(n.id).toBe('b1');
  });

  it('⭐⭐ ถ้า normalise ทั้งซองโดยไม่แกะ = id หาย — นี่คือบั๊กเดิม', () => {
    const enveloped = { data: { ...ROW }, results: [] };
    expect((normalizeBroadcast(enveloped as never) as any).id).toBe('');
  });
});
