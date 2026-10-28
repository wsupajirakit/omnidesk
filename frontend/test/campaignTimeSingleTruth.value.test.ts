/**
 * [FIX-20260824-ONETIMEZONE] เวลาบนหน้าบรอดแคสต์ต้องหมายถึงสิ่งเดียวกันเสมอ
 * ===========================================================================
 * เจ้าของ 24/08: *"ทำ single truth เรื่องเวลา boardcast ต้องผ่านจุดเดียว"* ·
 * *"อย่าลืมเรื่องว่า single truth ต้องไม่มีปัญหา"*.
 *
 * 🔴 บั๊กที่ไฟล์นี้ล็อกไว้ ไม่ใช่ crash แต่เป็น **ค่าสองค่าที่ควรเท่ากันแล้วไม่เท่า**
 *    เดิม: ค่าเงื่อนไขปั๊ม offset ของเบราว์เซอร์ · `scheduled_at` ส่งดิบให้ BE
 *    เติม `+07:00` ⇒ พิมพ์ `15:00` ในหน้าเดียวกันสองช่อง เปิดจาก New York
 *    ได้ instant ห่างกัน 11 ชั่วโมง โดยไม่มี error อะไรเลย
 *
 * ⚠️ ทุกเคสรันซ้ำใต้ `TZ` หลายค่า — เทสที่รันแต่บนเครื่องคนเขียน (ไทย) จะเขียว
 *    ทั้งที่โค้ดผิด เพราะบนโซนไทยค่าเก่ากับค่าใหม่ **บังเอิญตรงกัน**
 *    นั่นคือเหตุผลเดียวที่บั๊กนี้อยู่มาได้โดยไม่มีใครเห็น
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  CAMPAIGN_OFFSET,
  CAMPAIGN_OFFSET_MIN,
  campaignDaysAgo,
  fromCampaignIso,
  toCampaignIso,
} from '../components/campaign/campaignTime';
import { applyMint, MINTS } from '../components/campaign/mint';

/**
 * เปลี่ยน timezone ของ process ชั่วคราว
 *
 * ⚠️ ต้อง `new Intl.DateTimeFormat()` ใหม่หลังเปลี่ยน `process.env.TZ` — Node
 *    แคชโซนไว้ตอนใช้ครั้งแรก การไม่รีเซ็ตทำให้เทสดู "ผ่าน" ทั้งที่ไม่เคยเปลี่ยนโซนจริง
 */
const withTz = <T,>(tz: string, fn: () => T): T => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = before;
  }
};

afterEach(() => {
  /* กันเทสตัวถัดไปรับโซนค้างมา */
  delete process.env.TZ;
});

const ZONES = ['Asia/Bangkok', 'UTC', 'America/New_York', 'Pacific/Kiritimati'];

describe('ประตูเดียว — โซนถูกประกาศ ไม่ได้อ่านจากเครื่อง', () => {
  it('offset เป็น +07:00 และตรงกับที่ BE ประกาศไว้', () => {
    /* 🔴 ต้องเท่ากับ `DEFAULT_INPUT_OFFSET` ใน omnidesk-api/src/modules/content/broadcast-time.ts
       ถ้าสองฝั่งไม่ตรง ค่าที่ฟอร์มส่ง กับค่าที่ BE เดาให้ client เก่า จะคนละความหมาย */
    expect(CAMPAIGN_OFFSET).toBe('+07:00');
    expect(CAMPAIGN_OFFSET_MIN).toBe(420);
  });

  it('🔴 ค่าที่พิมพ์ แปลว่า instant เดียวกันทุกโซนที่เปิด', () => {
    const got = ZONES.map(tz =>
      withTz(tz, () => new Date(toCampaignIso('2026-08-24T15:00')).toISOString()),
    );
    /* ก่อนแก้: ค่านี้จะต่างกันตามโซนของเบราว์เซอร์ */
    expect(new Set(got).size).toBe(1);
    expect(got[0]).toBe('2026-08-24T08:00:00.000Z');
  });

  it('🔴 กล่องแสดงเวลาไทยเสมอ ไม่ใช่เวลาเครื่องคนเปิด', () => {
    const shown = ZONES.map(tz =>
      withTz(tz, () => fromCampaignIso('2026-08-24T08:00:00.000Z')),
    );
    expect(new Set(shown).size).toBe(1);
    /* 08:00Z = 15:00 ไทย — ตัวเลขที่เห็นต้องตรงกับความหมายที่เก็บ */
    expect(shown[0]).toBe('2026-08-24T15:00');
  });

  it('ไป-กลับแล้วได้ค่าเดิม ในทุกโซน', () => {
    for (const tz of ZONES) {
      withTz(tz, () => {
        expect(fromCampaignIso(toCampaignIso('2026-08-24T15:00'))).toBe(
          '2026-08-24T15:00',
        );
      });
    }
  });

  it('ว่างอยู่ว่าง — ไม่กลายเป็น "ตอนนี้"', () => {
    expect(toCampaignIso('')).toBe('');
    expect(toCampaignIso('   ')).toBe('');
    expect(fromCampaignIso('')).toBe('');
    expect(fromCampaignIso(undefined)).toBe('');
    expect(fromCampaignIso('ไม่ใช่วันที่')).toBe('');
  });

  it('ค่าที่มี offset อยู่แล้ว ไม่ถูกปั๊มซ้ำ', () => {
    expect(toCampaignIso('2026-08-24T15:00:00+07:00')).toBe(
      '2026-08-24T15:00:00+07:00',
    );
    expect(toCampaignIso('2026-08-24T08:00:00Z')).toBe('2026-08-24T08:00:00Z');
  });
});

describe('🔴 สองช่องบนหน้าเดียวกัน ต้องหมายถึง instant เดียวกัน', () => {
  /**
   * นี่คือเคสที่เป็นบั๊กจริง ๆ — ไม่ใช่เรื่องรูปแบบสตริง แต่เป็นเรื่อง
   * "พิมพ์เลขเดียวกันสองช่อง แล้วได้คนละเวลา"
   */
  it('scheduled_at กับ ค่าเงื่อนไข ให้ instant เดียวกันทุกโซน', () => {
    for (const tz of ZONES) {
      withTz(tz, () => {
        const scheduled = new Date(toCampaignIso('2026-08-24T15:00')).getTime();
        const ruleValue = new Date(toCampaignIso('2026-08-24T15:00')).getTime();
        expect(scheduled).toBe(ruleValue);
        expect(scheduled).toBe(Date.parse('2026-08-24T08:00:00.000Z'));
      });
    }
  });
});

describe('mint ไม่ผ่านประตูเวลาอีกแล้ว — มันไม่มีเวลาให้ผ่าน', () => {
  /* [FIX-20260826-MINTHASVALUE] **พลิกเคส ไม่ลบ**
     เดิมสองเคสนี้พิสูจน์ว่า "ค่าเวลาที่ mint สร้าง เท่ากันทุกโซน" และ "ถอยหลัง
     ตามจำนวนวันจริง" · ตอนนี้ mint กรอก `has_value` ซึ่ง **ไม่มีค่าเวลาเลย**
     ตามที่ฝั่ง BE ล็อกไว้ (`[UI-20260825-LOCKHASVALUE]` — stamp เป็น rolling
     เงื่อนไขที่อิงเวลาจึงเปลี่ยนความหมายไปเอง เคยทำให้ผู้รับเหลือ 0 คนมาแล้ว)
     ⇒ เคสจึงเปลี่ยนไปพิสูจน์สิ่งที่ **ต้องจริงตอนนี้**: mint ต้องไม่แอบใส่เวลากลับมา
     ถ้าวันหนึ่งมี mint ที่ใช้เวลาอีก ให้เพิ่มเคสใหม่ อย่าแก้เคสนี้ให้หลวมลง */
  const choice = () => {
    const c = MINTS[0]?.choices[0];
    if (!c) throw new Error('registry ว่าง');
    return c;
  };

  it('⭐ ทุก choice ใช้ has_value และไม่มีค่าเวลาติดมา', () => {
    for (const mint of MINTS) {
      for (const c of mint.choices) {
        expect({ id: c.id, op: c.op }).toEqual({ id: c.id, op: 'has_value' });
        expect(c).not.toHaveProperty('value');
      }
    }
  });

  it('⭐ rule ที่ mint สร้าง มี value เป็นสตริงว่าง — เท่ากันทุกโซน', () => {
    const now = new Date('2026-08-24T11:30:00.000Z');
    const got = ZONES.map(tz =>
      withTz(tz, () => applyMint([choice()], now).rules[0]?.value),
    );
    expect(new Set(got).size).toBe(1);
    expect(got[0]).toBe('');
  });

  it('campaignDaysAgo คืนรูปที่กล่องแสดงได้', () => {
    const out = campaignDaysAgo(7, new Date('2026-08-24T11:30:00.000Z'));
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
