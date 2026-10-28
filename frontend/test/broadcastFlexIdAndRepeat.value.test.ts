/**
 * [FEAT-20260824-BCASTFLEXID] [FEAT-20260824-BCASTREPEAT]
 * ===========================================================================
 * Owner, 24/08: *"ทุกรูปแบบการตั้งค่า เวลา + ตั้งผ่าน fe ด้วย + dynami card +
 * plain card + ข้อความธรรมดา แยก เทสให้ครบ"* — so the card kinds and the cadence
 * shapes are proven APART, not as one happy path.
 *
 * These are value tests on purpose: the two decisions worth freezing are pure —
 * what leaves the form as `message`, and how minutes map to a clock. Mounting
 * the modal to assert them would test the modal, not the decision.
 */
import { describe, it, expect } from 'vitest';

import {
  buildMessagePayload,
  type MessagePayload
} from '../components/campaign/flex/buildMessagePayload';
import {
  hhMmToMinutes,
  minutesToHhMm,
  MIN_EVERY_MINUTES,
  DAY_MINUTES,
  DEFAULT_TZ_OFFSET_MIN
} from '../components/campaign/schedule/RepeatRuleForm';

const CARD_ID = 'a0d00000000000000000002f';
const OWN_COPY = { type: 'bubble', body: { stale: true } };

describe('buildMessagePayload — ข้อความธรรมดา (text)', () => {
  it('🔴 ส่งข้อความดิบติดไปกับ job ไม่แตะ flex อะไรเลย', () => {
    /* เจ้าของ 24/08: "ยกเว้น text กรอกดิบ เซฟติด job" */
    const out = buildMessagePayload({ type: 'text', text: 'สวัสดี' }, '');
    expect(out).toEqual({ type: 'text', text: 'สวัสดี' });
    expect(out).not.toHaveProperty('flex_id');
    expect(out).not.toHaveProperty('flex_json');
  });

  it('ไม่ยุ่งกับ flexText ที่ค้างอยู่ในฟอร์ม', () => {
    const out = buildMessagePayload({ type: 'text', text: 'ก' }, '{"a":1}');
    expect(out).not.toHaveProperty('flex_json');
  });
});

describe('buildMessagePayload — รูปภาพ (image)', () => {
  it('🔴 ทำงานแบบเดิมเป๊ะ', () => {
    /* เจ้าของ 24/08: "ส่วนแบบ image ก็ทำงานได้แบบเดิมนั้นแหละ" */
    const msg: MessagePayload = {
      type: 'image',
      image_url: 'https://example.test/a.png'
    };
    expect(buildMessagePayload(msg, '')).toEqual(msg);
  });
});

describe('buildMessagePayload — plain card (การ์ดใบเดียวทุกคน)', () => {
  it('🔴 เลือกการ์ดแล้วส่ง flex_id ขึ้นไป', () => {
    const out = buildMessagePayload({ type: 'flex', flex_id: CARD_ID }, '');
    expect(out.flex_id).toBe(CARD_ID);
  });

  it('🔴 กล่อง json ว่าง ต้องไม่ระเบิด', () => {
    /* ที่ textarea เดิมเคยทำ: `JSON.parse('')` โยน SyntaxError จากใน submit
       handler ⇒ กดเซฟแล้วเงียบ ไม่มีอะไรเกิดขึ้น ไม่มี error ให้เห็น */
    expect(() =>
      buildMessagePayload({ type: 'flex', flex_id: CARD_ID }, '')
    ).not.toThrow();
    expect(buildMessagePayload({ type: 'flex', flex_id: CARD_ID }, '')).not
      .toHaveProperty('flex_json');
  });

  it('🔴 json เสีย ต้องไม่ระเบิด — ปล่อยให้ BE ตอบ', () => {
    expect(() =>
      buildMessagePayload({ type: 'flex', flex_id: CARD_ID }, '{ ไม่ใช่ json')
    ).not.toThrow();
  });

  it('id ว่าง/ช่องว่างล้วน = ไม่ผูกการ์ด ไม่ใช่ผูกกับค่าว่าง', () => {
    expect(
      buildMessagePayload({ type: 'flex', flex_id: '   ', flex_json: OWN_COPY }, '')
    ).not.toHaveProperty('flex_id');
  });
});

describe('buildMessagePayload — dynamic card (ค่าเฉพาะคน)', () => {
  it('🔴 ผูก id ทางเดียวกับ plain card ไม่มีเส้นทางที่สอง', () => {
    /* การ์ดรายคนต่างกันที่ "เรนเดอร์ยังไง" ไม่ใช่ "การ์ดมาจากไหน"
       ถ้ามีสองเส้นทางดึงการ์ด มันจะเพี้ยนกันในวันที่ใครแก้ข้างเดียว */
    const out = buildMessagePayload({ type: 'flex', flex_id: CARD_ID }, '');
    expect(out).toMatchObject({ type: 'flex', flex_id: CARD_ID });
  });

  it('ไม่ pre-render tag ใด ๆ — การแทนค่าเกิดทีหลัง รายคน', () => {
    const body = { contents: [{ type: 'text', text: 'สวัสดี {{member.name}}' }] };
    const out = buildMessagePayload(
      { type: 'flex', flex_id: CARD_ID },
      JSON.stringify(body)
    );
    expect(JSON.stringify(out.flex_json)).toContain('{{member.name}}');
  });
});

describe('buildMessagePayload — งานเก่าต้องไม่พัง (seamless)', () => {
  it('🔴 ใบที่มีแต่สำเนา json เดิม ต้องพาสำเนาไปด้วย ห้ามทิ้ง', () => {
    /* ถ้าทิ้ง: แค่เปลี่ยนชื่อแคมเปญปี 2025 ก็ลบการ์ดของมันไปเลย */
    const out = buildMessagePayload({ type: 'flex', flex_json: OWN_COPY }, '');
    expect(out.flex_json).toEqual(OWN_COPY);
    expect(out).not.toHaveProperty('flex_id');
  });

  it('พิมพ์ json ใหม่ทับ ต้องใช้ของใหม่', () => {
    const fresh = { type: 'bubble', body: { fresh: true } };
    const out = buildMessagePayload(
      { type: 'flex', flex_json: OWN_COPY },
      JSON.stringify(fresh)
    );
    expect(out.flex_json).toEqual(fresh);
  });

  it('มีทั้ง id และสำเนา — ส่งทั้งคู่ แล้วให้ BE ตัดสินว่า id ชนะ', () => {
    const out = buildMessagePayload(
      { type: 'flex', flex_id: CARD_ID, flex_json: OWN_COPY },
      ''
    );
    expect(out.flex_id).toBe(CARD_ID);
    expect(out.flex_json).toEqual(OWN_COPY);
  });
});

describe('RepeatRuleForm — นาที ↔ นาฬิกา ทุกรูปแบบเวลา', () => {
  it('🔴 540 = 09:00 · 1080 = 18:00 — ตรงกับที่ BE เขียนไว้ในสเปค', () => {
    expect(minutesToHhMm(540)).toBe('09:00');
    expect(minutesToHhMm(1080)).toBe('18:00');
    expect(minutesToHhMm(0)).toBe('00:00');
    expect(minutesToHhMm(DAY_MINUTES)).toBe('24:00');
  });

  it('แปลงกลับได้ตรงกัน', () => {
    expect(hhMmToMinutes('09:00')).toBe(540);
    expect(hhMmToMinutes('18:00')).toBe(1080);
    expect(hhMmToMinutes('00:00')).toBe(0);
    expect(hhMmToMinutes(' 07:30 ')).toBe(450);
  });

  it('🔴 ค่าที่อ่านไม่ออกต้องได้ null ไม่ใช่เดา', () => {
    /* เดาแล้วส่งขึ้นไป = แคมเปญยิงเวลาที่แอดมินไม่ได้สั่ง */
    expect(hhMmToMinutes('')).toBeNull();
    expect(hhMmToMinutes('9')).toBeNull();
    expect(hhMmToMinutes('25:00')).toBeNull();
    expect(hhMmToMinutes('09:99')).toBeNull();
    expect(hhMmToMinutes('อะไรก็ไม่รู้')).toBeNull();
  });

  it('ค่าที่เกินขอบ ถูกบีบเข้ากรอบวัน ไม่ใช่พังหรือติดลบ', () => {
    expect(minutesToHhMm(-5)).toBe('00:00');
    expect(minutesToHhMm(99999)).toBe('24:00');
  });
});

describe('RepeatRuleForm — ค่าคงที่ต้องตรงกับฝั่ง BE', () => {
  it('🔴 หน่วยเป็นนาที และเพดานล่างตรงกับ MIN_EVERY_MINUTES ของ BE', () => {
    /* BE: MIN_EVERY_MINUTES = ceil(60 / MAX_RUNS_PER_JOB_PER_HOUR) = 60/6 = 10
       ถ้าสองฝั่งไม่ตรง ฟอร์มจะให้ตั้งค่าที่ abuse guard ปฏิเสธ — แอดมินตั้งได้
       แต่ยิงไม่ออก โดยไม่มีใครบอกว่าทำไม */
    expect(MIN_EVERY_MINUTES).toBe(10);
    expect(DAY_MINUTES).toBe(1440);
  });

  it('🔴 timezone เป็นตัวเลข ไม่ใช่ชื่อโซน — +07:00 = 420', () => {
    /* BE รับ tz_offset_min เป็นนาที ส่ง "Asia/Bangkok" ไปจะถูกอ่านเป็น
       ค่าใช้ไม่ได้แล้ว clamp เป็นค่า default เงียบ ๆ */
    expect(DEFAULT_TZ_OFFSET_MIN).toBe(420);
  });
});
