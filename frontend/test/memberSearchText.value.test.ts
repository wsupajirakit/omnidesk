/* [FIX-20260817-SEARCHRAWPROFILE] ค้นลูกค้าได้จากทั้ง DB field และ raw profile
 * ===========================================================================
 * อาการที่รายงานเข้ามา 17/08: ค้นด้วย **เลขบัญชี** ที่ panel ขวาโชว์อยู่ (5864854725)
 * แล้วหน้า ticket-support ไม่เจอ · ข้อกำหนด: ค้นได้ด้วย **ชื่อไลน์ · เบอร์ · ชื่อ-สกุล ·
 * เลขที่บัญชี** จากทั้งสองแหล่ง · และ **ไม่รวม** domain / agent / truewallet
 *
 * ต้นเหตุจริง (ตรวจแถวจริงใน DB): haystack เดิมอ่าน `bank_account` `bank_name`
 * `account_name` `true_wallet` `domain` `agent` `agent_code` — **7 ตัวนี้ไม่มีอยู่ใน
 * member schema เลย** ค่าจริงอยู่ใน `raw_profile_data.data.profile.*`
 *
 * ค่าที่ใช้ในเทสนี้คือค่าจากแถวจริงบน dev (member `bbbb` / judy / 0955550010) —
 * ไม่ได้แต่งขึ้น เพื่อให้เคสสะท้อนของที่ระบบเจอจริง
 */
import { describe, it, expect } from 'vitest';

import {
  memberSearchHaystack,
  memberMatchesSearch,
} from '../utils/memberSearchText';

/** แถวจริง: ไม่มี field ธนาคารแบน ๆ เลย ข้อมูลอยู่ใน raw ทั้งหมด */
const MEMBER_WITH_RAW = {
  display_name: 'bbbb',
  nickname: 'bbbb',
  full_name: 'judy',
  phone_number: '0955550010',
  contract_code: '',
  detail: null,
  line_user_id: 'Ubd88e26129e244f2b63527b834e94dd7',
  raw_profile_data: {
    success: true,
    data: {
      profile: {
        web_code: 'demo-omnidesk',
        line_of_work: 'master',
        phone: '0955550010',
        truewallet: '',
        bank: { code: 'BBL', account_no: '5864854725', account_name: 'judy' },
      },
    },
  },
};

/** ลูกค้าที่ยังไม่เคยดึงโปรไฟล์ — มีแต่ field ใน DB (9/13 แถวบน dev เป็นแบบนี้) */
const MEMBER_DB_ONLY = {
  display_name: 'tttdev',
  nickname: 'tttdev',
  full_name: 'judy',
  phone_number: '0955550010',
  contract_code: 'CT-9001',
  detail: null,
  line_user_id: 'U2e9daca4b8ab5265a21e3ecda626a720',
};

describe('[SEARCHRAWPROFILE] ค้นเจอตามที่สั่ง', () => {
  it('⭐ เลขบัญชี — เคสที่รายงานว่าหาไม่เจอ', () => {
    expect(memberMatchesSearch(MEMBER_WITH_RAW, '5864854725')).toBe(true);
    // บางส่วนของเลขก็ต้องเจอ (พิมพ์ไม่ครบ)
    expect(memberMatchesSearch(MEMBER_WITH_RAW, '58648')).toBe(true);
  });

  it('⭐ ชื่อไลน์ (display name / nickname)', () => {
    expect(memberMatchesSearch(MEMBER_WITH_RAW, 'bbbb')).toBe(true);
    expect(memberMatchesSearch(MEMBER_WITH_RAW, 'BBBB')).toBe(true); // ไม่แคร์ตัวพิมพ์
    expect(memberMatchesSearch(MEMBER_DB_ONLY, 'tttdev')).toBe(true);
  });

  it('⭐ เบอร์ — ทั้งจาก DB field และจากในโปรไฟล์', () => {
    expect(memberMatchesSearch(MEMBER_WITH_RAW, '0955550010')).toBe(true);
    expect(memberMatchesSearch(MEMBER_DB_ONLY, '0955550010')).toBe(true);
    // เบอร์อยู่แค่ใน raw (บาง member ไม่มี phone_number แบน)
    const rawOnlyPhone = {
      display_name: 'x',
      raw_profile_data: { data: { profile: { phone: '0812345678' } } },
    };
    expect(memberMatchesSearch(rawOnlyPhone, '0812345678')).toBe(true);
  });

  it('⭐ ชื่อ-สกุล — ทั้ง full_name และชื่อบัญชีธนาคาร', () => {
    expect(memberMatchesSearch(MEMBER_WITH_RAW, 'judy')).toBe(true);
    const nameOnlyInBank = {
      display_name: 'x',
      raw_profile_data: {
        data: { profile: { bank: { account_name: 'สมชาย ใจดี' } } },
      },
    };
    expect(memberMatchesSearch(nameOnlyInBank, 'สมชาย')).toBe(true);
  });

  it('พิมพ์เลขมีขีด/เว้นวรรคก็ต้องเจอ (ค่าที่เก็บเป็นเลขล้วน)', () => {
    expect(memberMatchesSearch(MEMBER_WITH_RAW, '586-485-4725')).toBe(true);
    expect(memberMatchesSearch(MEMBER_WITH_RAW, '095 555 0010')).toBe(true);
  });

  it('⭐ ค่าที่ "เก็บ" มีขีดอยู่แล้ว แต่พิมพ์เป็นเลขล้วน ก็ต้องเจอ', () => {
    /* เคสนี้มาจากข้อมูลจริง: บน dev มี account_no = "xxx-x-x4004-x" (ปลายทางส่งมาแบบ
       มีขีด/ปิดบัง) ⇒ haystack ต้องเก็บ "รูปเลขล้วน" ของค่าที่เก็บไว้ด้วย ไม่ใช่แค่
       normalise คำค้น · mutation ที่ถอดส่วนนี้ออกเคย "รอด" เพราะเทสรอบแรกไม่มีเคสนี้ */
    const formatted = {
      display_name: 'x',
      raw_profile_data: {
        data: { profile: { bank: { account_no: '586-485-4725' } } },
      },
    };
    expect(memberMatchesSearch(formatted, '5864854725')).toBe(true);
    // เบอร์ที่เก็บแบบมีขีดก็เหมือนกัน
    expect(
      memberMatchesSearch({ phone_number: '095-555-0010' }, '0955550010'),
    ).toBe(true);
  });
});

describe('[SEARCHRAWPROFILE] สิ่งที่ตั้งใจไม่ค้น (ตามข้อกำหนด)', () => {
  it('⭐ domain (web_code) และ agent (line_of_work) ต้อง NOT เจอ', () => {
    expect(memberMatchesSearch(MEMBER_WITH_RAW, 'demo-omnidesk')).toBe(false);
    expect(memberMatchesSearch(MEMBER_WITH_RAW, 'master')).toBe(false);
  });

  it('⭐ truewallet และรหัสธนาคารไม่อยู่ในรายการ', () => {
    const withWallet = {
      display_name: 'x',
      raw_profile_data: {
        data: {
          profile: {
            truewallet: '0999999999',
            bank: { code: 'SCB', account_no: '1112223334' },
          },
        },
      },
    };
    expect(memberMatchesSearch(withWallet, '0999999999')).toBe(false);
    expect(memberMatchesSearch(withWallet, 'scb')).toBe(false);
    // เลขบัญชีของคนเดียวกันยังเจอ — พิสูจน์ว่าไม่ได้ตัดทั้ง bank
    expect(memberMatchesSearch(withWallet, '1112223334')).toBe(true);
  });

  it('⭐ ไม่เอาทั้ง blob มาใส่ — ค่าอื่นในโปรไฟล์ต้องไม่ค้นเจอ', () => {
    const noisy = {
      display_name: 'x',
      raw_profile_data: {
        data: {
          profile: {
            bank: { account_no: '1' },
            promotion: { secret_code: 'PROMOSECRET' },
            finance: { token: 'sk_live_should_never_be_searchable' },
          },
        },
      },
    };
    const hay = memberSearchHaystack(noisy);
    expect(hay).not.toContain('promosecret');
    expect(hay).not.toContain('sk_live');
  });
});

describe('[SEARCHRAWPROFILE] ขอบที่ต้องไม่พัง', () => {
  it('คำค้นว่าง = ไม่กรอง', () => {
    expect(memberMatchesSearch(MEMBER_DB_ONLY, '')).toBe(true);
    expect(memberMatchesSearch(MEMBER_DB_ONLY, '   ')).toBe(true);
    expect(memberMatchesSearch(MEMBER_DB_ONLY, null)).toBe(true);
  });

  it('member เป็น null/undefined = ไม่ throw และไม่แมตช์', () => {
    expect(memberMatchesSearch(null, 'judy')).toBe(false);
    expect(memberMatchesSearch(undefined, 'judy')).toBe(false);
    expect(memberSearchHaystack(null)).toBe('');
  });

  it('raw profile รูปอื่น ({profile} ตรง ๆ / เนื้อล้วน) ก็ต้องอ่านได้', () => {
    expect(
      memberMatchesSearch(
        { raw_profile_data: { profile: { bank: { account_no: '777' } } } },
        '777',
      ),
    ).toBe(true);
    expect(
      memberMatchesSearch(
        { raw_profile_data: { bank: { account_no: '888' } } },
        '888',
      ),
    ).toBe(true);
  });

  it('extras ของผู้เรียก (ค่าที่แกะจาก detail + line_user_id ของตั๋ว) ถูกนับด้วย', () => {
    expect(
      memberMatchesSearch(MEMBER_DB_ONLY, 'CT-2222', ['CT-2222']),
    ).toBe(true);
  });

  it('raw เป็นค่าที่ไม่ใช่ object ก็ไม่พัง', () => {
    expect(() =>
      memberSearchHaystack({ display_name: 'x', raw_profile_data: 'oops' }),
    ).not.toThrow();
  });
});

/**
 * หน้าเพจใหญ่เกิน render ใน vitest (fetch ตอน mount + WS) จึงล็อกที่ source ว่า
 * ตัวกรองทั้งสองชุดเรียกตัวเดียวกัน และ field ที่ไม่มีในสคีมาไม่กลับมา
 */
describe('[SEARCHRAWPROFILE] TicketChat ใช้ตัวเดียวกันทั้ง 2 จุด', () => {
  it('เรียก memberMatchesSearch 2 ครั้ง และไม่มี field ที่ตายแล้วเหลืออยู่', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const code = readFileSync(
      resolve(__dirname, '../pages/chat/TicketChat.tsx'),
      'utf8',
    );
    /* [SEARCHMIN4] (งาน 5.9) อาร์กิวเมนต์เปลี่ยนเป็น activeSearch — derived
       ≥4 ตัวอักษรจาก searchPhone (ต่ำกว่านั้น = ไม่ค้นเลย ตามคำสั่งเซฟ request) */
    expect(code.match(/memberMatchesSearch\(ud, activeSearch/g)?.length).toBe(2);
    for (const dead of [
      'ud?.bank_account',
      'ud?.bank_name',
      'ud?.account_name',
      'ud?.true_wallet',
      'ud?.domain',
      'ud?.agent',
      'ud?.agent_code',
    ]) {
      expect(code).not.toContain(dead);
    }
  });
});
