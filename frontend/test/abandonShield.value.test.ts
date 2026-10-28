/* [FEAT-20260821-ABANDONSHIELD] โล่ปิด/เปิดระบบช่วยเหลือลงทะเบียน
 * ===========================================================================
 * คำสั่งเจ้าของ (20/08/2026) คำต่อคำ:
 *   `ignore_abandon_assist = false` = default ของทุกคน > โล่สีเงินขอบสีเขียว
 *   **ทุกคน** ขวาล่าง มีเฉพาะ avatar ฝั่งขวาของ panel · **คลิกแล้วเลือกได้**
 *   // `true` เป็นโล่สีเทาจาง ๆ // กดแล้วมี modal ถาม (แปล eng/th) ข้อความสลับตามสถานะ
 *
 * ⚠️ รอบแรกทำเป็น badge ที่โผล่ **เฉพาะตอน `true`** ⇒ สถานะปกติไม่เห็นอะไรเลย
 * และไม่มีอะไรให้กด — ผิดโจทย์ · เจ้าของทัก 21/08 ว่า *"โล่หายไปไหน"*
 * เคสแรกในไฟล์นี้จึงปักเรื่อง "แสดงทุกคน" ไว้เป็นข้อแรก เพราะนั่นคือสิ่งที่พลาด
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAbandonShieldOff } from '../services/chat/ignoreAbandonService';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const shield = read('components/chat/IgnoreAbandonShield.tsx');
const page = ticketChatSource();
const service = read('services/chat/ignoreAbandonService.ts');
const noComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('⭐ อ่านค่าด้วย === true เท่านั้น', () => {
  it('⭐ แถวที่ไม่มี field อ่านได้ว่า "ยังตามอยู่" ไม่ใช่ "ปิดแล้ว"', () => {
    /* member ที่มีก่อน column นี้อ่านได้ undefined — API ส่งแถวมาตามที่เป็น
       เขียน !== false เมื่อไหร่ = ทุกคนกลายเป็นปิดอยู่ทันที */
    expect(isAbandonShieldOff({})).toBe(false);
    expect(isAbandonShieldOff({ ignore_abandon_assist: undefined })).toBe(false);
    expect(isAbandonShieldOff(null)).toBe(false);
    expect(isAbandonShieldOff(undefined)).toBe(false);
  });

  it('⭐ ค่า truthy อื่นไม่นับ', () => {
    for (const v of ['true', 'false', 1, 0, 'yes', {}, []]) {
      expect(isAbandonShieldOff({ ignore_abandon_assist: v })).toBe(false);
    }
  });

  it('boolean true เท่านั้นที่แปลว่าปิด', () => {
    expect(isAbandonShieldOff({ ignore_abandon_assist: true })).toBe(true);
    expect(isAbandonShieldOff({ ignore_abandon_assist: false })).toBe(false);
  });

  it('⭐ source ไม่มี !== false / ?? true ที่ไหนเลย', () => {
    const code = noComments(service) + noComments(shield);
    expect(code).not.toMatch(/!==\s*false/);
    expect(code).not.toMatch(/\?\?\s*true/);
  });
});

describe('⭐ โล่แสดงทุกคน ไม่ใช่เฉพาะตอนปิด — จุดที่รอบแรกพลาด', () => {
  it('⭐ ไม่มีเงื่อนไขไหนกันไม่ให้ render ตอนสถานะปกติ', () => {
    /* ตัว component ตัดสินแค่ "มี memberId ไหม" ไม่ได้ตัดสินจากสถานะ */
    const body = noComments(shield);
    expect(body).toContain('if (!memberId) return null');
    /* ห้ามมี early-return ที่อิงสถานะ */
    expect(body).not.toMatch(/if\s*\(\s*!?\s*isOff\s*\)\s*return/);
  });

  it('⭐ สองสถานะให้ไอคอนคนละตัว', () => {
    expect(shield).toContain('ShieldCheck');
    expect(shield).toContain('Shield');
    expect(shield).toMatch(/data-state=\{isOff \? 'off' : 'on'\}/);
  });

  it('สีตรงตามที่สั่ง — เขียว = ปกติ · เทา = ปิด', () => {
    const cls = shield.slice(shield.indexOf('className={`absolute'));
    expect(cls).toMatch(/emerald/);
    expect(cls).toMatch(/slate/);
  });
});

describe('⭐ วางถูกที่และไม่ชนกับ avatar ring', () => {
  it('⭐ อยู่ขวาล่าง ด้วย absolute — และเยื้องพ้นขอบ avatar', () => {
    /* [FIX-20260830-SHIELDREACH] เดิม pin ว่า `bottom-0…right-0` ซึ่งตรงกับ
       `-bottom-0.5 -right-0.5` (2px) — เกาะขอบ avatar จนกดยาก (เจ้าของแจ้ง
       30/08) · เจตนาที่เคสนี้กันคือ "เป็น badge absolute มุมขวาล่าง" ซึ่งยัง
       จริงทุกตัวอักษร · เพิ่มเงื่อนไขว่าต้องเยื้องพ้นขอบและเป้ากดไม่เล็กกว่า
       24px ด้วย ⇒ แรงกว่าเดิม ไม่ใช่ผ่อน */
    expect(shield).toMatch(/absolute[^`]*-bottom-1[^`]*-right-1\.5/);
    expect(shield).toMatch(/\bw-6 h-6\b/);
    // ไอคอนขนาดเท่าเดิม — โตแค่พื้นที่กด
    expect(shield).toMatch(/Shield size=\{11\}/);
  });

  it('⭐ ไม่แตะ avatarRingClass เลย', () => {
    /* ring เข้ารหัส orphan-room อยู่แล้ว และ orphanRooms.value.test.ts assert
       สตริงนั้นแบบเป๊ะ — โล่ต้องเป็น element แยก */
    expect(noComments(shield)).not.toContain('avatarRingClass');
    expect(page).toContain('${avatarRingClass(ticket)}');
  });

  it('⭐ ถูก mount ใน TicketChat จริง พร้อม memberId', () => {
    expect(page).toContain('<IgnoreAbandonShield');
    expect(page).toMatch(/memberId=\{\(ud as \{ _id\?: string \}/);
  });
});

describe('⭐ modal ยืนยัน ข้อความสลับตามสถานะ', () => {
  const th = JSON.parse(read('i18n/translations/th.json')) as Record<string, string>;
  const en = JSON.parse(read('i18n/translations/en.json')) as Record<string, string>;

  it('⭐ ทุกคีย์ที่ component เรียก มีครบทั้งสองภาษา', () => {
    const keys = [...shield.matchAll(/t\('([^']+)'\)/g)].map((m) => m[1] as string);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const k of new Set(keys)) {
      expect((th[k] ?? '').length, `th ขาด ${k}`).toBeGreaterThan(0);
      expect((en[k] ?? '').length, `en ขาด ${k}`).toBeGreaterThan(0);
    }
  });

  it('⭐ ข้อความสลับจริง — สองสถานะใช้คีย์คนละชุด', () => {
    expect(shield).toContain('abandon_shield_confirm_on_title');
    expect(shield).toContain('abandon_shield_confirm_off_title');
    expect(shield).toMatch(/isOff \?\s*t\('ticket\.abandon_shield_confirm_on_title'\)/);
  });

  it('ข้อความบอกสถานะปัจจุบันและสถานะที่จะเปลี่ยนไป', () => {
    /* คำสั่ง: "(สถานะปัจจุบันคือ xx) ต้องการ xx (สถานะตรงข้าม) ใช่หรือไม่" */
    expect(th['ticket.abandon_shield_confirm_off_message']).toContain('สถานะปัจจุบัน');
    expect(th['ticket.abandon_shield_confirm_on_message']).toContain('สถานะปัจจุบัน');
    expect(en['ticket.abandon_shield_confirm_off_message']).toContain('Current');
  });
});

describe('⭐ ส่ง boolean แท้เท่านั้นไป BE', () => {
  it('⭐ body เป็น boolean ไม่ใช่สตริง', () => {
    /* BE ตั้งใจไม่ใช้ DTO เพราะ enableImplicitConversion แปลง "false" เป็น true
       ⇒ ส่งสตริงมาจะได้ 400 */
    expect(service).toContain('ignore_abandon_assist: value');
    const fn = service.slice(service.indexOf('setIgnoreAbandon'));
    expect(fn).toContain('value: boolean');
  });

  it('ยิงไปที่ route ที่ BE เปิดไว้จริง', () => {
    expect(service).toContain('/api/line-users/${memberId}/ignore-abandon');
    expect(service).toContain("method: 'PATCH'");
  });
});

describe('⭐ badge เดิมถูกซ่อน ไม่ได้ลบ', () => {
  it('⭐ ยังอยู่ในไฟล์แต่ไม่ render', () => {
    /* เจ้าของสั่ง "ซ่อนไว้" — `false &&` ทำให้ tsc/eslint ยังตรวจโค้ดข้างในให้ */
    expect(page).toContain('ignore-abandon-badge');
    expect(page).toMatch(/\{false && \(ud as \{ ignore_abandon_assist\?: unknown \}/);
  });
});
