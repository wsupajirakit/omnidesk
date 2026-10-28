/**
 * [FEAT-20260825-THAIDISPLAY] ทุกเวลาบนหน้าบรอดแคสต์ต้องอ่านเป็นเวลาไทย
 * ===========================================================================
 * เจ้าของ 25/08: *"fe ต้องแสดงผลเวลาไทย (เป็นจุดเดียวที่แสดงผลเวลาไทย)
 * create model / edit model / history boardcast + log cast ด้วย"*
 *
 * 🔴 บั๊กที่ล็อกไว้: `toLocaleString('th-TH')` ตั้งแค่ **ภาษา** ไม่ได้ตั้ง **โซน**
 *    ⇒ แอดมินที่เปิดจาก New York เห็นเวลานิวยอร์กเขียนเป็นเลขไทย แล้วเข้าใจว่า
 *    แคมเปญยิงเวลานั้น · ไม่มี error ไม่มีอะไรฟ้อง
 *
 * ⚠️ ต้องรันใต้ TZ หลายค่า — บนเครื่องไทยโค้ดผิดกับโค้ดถูกให้ผลเท่ากันเป๊ะ
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  formatCampaignTime,
  CAMPAIGN_TZ,
  CAMPAIGN_OFFSET_MIN,
} from '../components/campaign/campaignTime';
import { formatWhen } from '../components/campaign/history/runDetailFormat';

const ZONES = ['Asia/Bangkok', 'UTC', 'America/New_York', 'Pacific/Kiritimati'];

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
  delete process.env.TZ;
});

describe('formatCampaignTime — เวลาไทยเสมอ', () => {
  it('ชื่อโซนกับ offset ต้องหมายถึงโซนเดียวกัน', () => {
    /* ถ้าสองค่านี้หลุดจากกัน การคำนวณกับการแสดงผลจะคนละเวลา */
    expect(CAMPAIGN_TZ).toBe('Asia/Bangkok');
    expect(CAMPAIGN_OFFSET_MIN).toBe(420);
  });

  it('🔴 08:00Z อ่านได้ 15:00 เสมอ ไม่ว่าเปิดจากโซนไหน', () => {
    const out = ZONES.map(tz =>
      withTz(tz, () => formatCampaignTime('2026-08-25T08:00:00.000Z')),
    );
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toContain('15:00');
  });

  it('🔴 formatWhen (modal รายละเอียดรอบ) ก็ต้องเวลาไทยเหมือนกัน', () => {
    const out = ZONES.map(tz =>
      withTz(tz, () => formatWhen('2026-08-25T08:00:00.000Z')),
    );
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toContain('15:00');
  });

  it('อ่านไม่ได้ ⇒ ขีด ไม่ใช่ Invalid Date และไม่ใช่วันนี้', () => {
    expect(formatCampaignTime(undefined)).toBe('-');
    expect(formatCampaignTime('')).toBe('-');
    expect(formatCampaignTime('ไม่ใช่เวลา')).toBe('-');
    expect(formatCampaignTime(null)).toBe('-');
  });

  it('รับ Date ได้เหมือน string', () => {
    expect(formatCampaignTime(new Date('2026-08-25T08:00:00.000Z'))).toContain(
      '15:00',
    );
  });
});
