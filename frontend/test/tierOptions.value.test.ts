/**
 * [FEAT-2708-TIERUNLOCK] (งาน 5.5) tier list กลาง — pure function ที่เดียว
 * เจ้าของ: "แหล่งที่มาทำเป็น function pure กลางๆไว้ก่อนเพื่อเพิ่มเติม" พร้อมรูป
 * [{code:'normal',...,level:0},{silver,1},{gold,2}] — เพิ่ม tier ภายหลัง = เติมแถวเดียว
 */
import { describe, expect, it } from 'vitest';
import { BROADCAST_TIERS, tierOptions } from '../components/campaign/audience/tierOptions';

describe('[TIERUNLOCK] BROADCAST_TIERS', () => {
  it('⭐ รูปเป๊ะตามเจ้าของสั่ง: code/name/level ครบสาม ไล่ level 0,1,2', () => {
    expect(BROADCAST_TIERS).toEqual([
      { code: 'normal', name: 'Normal', level: 0 },
      { code: 'silver', name: 'Silver', level: 1 },
      { code: 'gold', name: 'Gold', level: 2 },
    ]);
  });

  it('code ไม่ซ้ำ · options ใช้ code เป็น value (WHERE ใช้ code — level มีไว้เผื่อสลับ)', () => {
    const codes = BROADCAST_TIERS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(tierOptions().map((o) => o.value)).toEqual(['normal', 'silver', 'gold']);
    expect(tierOptions()[0]?.label).toContain('Normal');
  });
});
