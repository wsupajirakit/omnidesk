/* [FEAT-20260825-CHATOPENFRESH] แค่คลิกการ์ด = ดึง raw profile + site rules สด
 *
 * เจ้าของ 25/08: *"แค่คลิกการ์ด (ไม่จำเป็นต้องเปิด หรือรับเคส) ให้ fetch สด
 * + บันทึกให้ record member นั้นด้วยข้อมูลล่าสุด + panel ขวาได้ข้อมูลล่าสุดด้วย
 * ทั้ง raw profile + site rule"*
 *
 * ⚠️ ไฟล์นี้ถูก **เขียนใหม่ทั้งไฟล์** หลัง mutation test รอบแรก
 *    รอบแรกปักด้วย "ไฟล์นี้มีสตริง 'chat_opened' ไหม" ⇒ ตอนลบโค้ดจริงออก
 *    (M3 = ตัด action ออกจากเงื่อนไข · M4 = ลบตัวฟังของการ์ด site rules)
 *    **เทสยังเขียวทั้งสองครั้ง** เพราะสตริงเดียวกันไปโผล่ที่บล็อกข้าง ๆ
 *    ⇒ ตรรกะถูกย้ายไป chatOpenedRefresh.ts เพื่อให้ทดสอบ "พฤติกรรม" ได้ตรง ๆ
 *      และ pin ที่เหลือใช้ **ชื่อฟังก์ชันซึ่งมีที่เดียวทั้ง repo** แทนสตริงทั่วไป
 *    บทเรียน: pin ด้วยสตริงที่โผล่ได้หลายที่ = ไม่ได้ปักอะไรเลย
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { chatOpenedDetail, profileRefreshPlan } from '../pages/chat/chatOpenedRefresh';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const strip = (s: string) =>
  /* line comments ก่อน block comments — ลำดับห้ามสลับ (composerDragRange.test.ts) */
  s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

const chat = strip(ticketChatSource());
const panel = strip(readFileSync(join(process.cwd(), 'components/profile-panel/ProfilePanel.tsx'), 'utf8'));
const svc = strip(readFileSync(join(process.cwd(), 'services/chat/ticketService.ts'), 'utf8'));

describe('[CHATOPENFRESH] §1 payload ของ event', () => {
  it('⭐ (T1) มี line_user_id → ได้ payload พร้อมยิง', () => {
    expect(chatOpenedDetail('U123')).toEqual({
      channel_user_id: 'U123',
      action: 'chat_opened',
    });
  });

  it('⭐ (T2) ไม่มี id → null (ห้ามยิง event ที่ไม่มีใครจับคู่ได้)', () => {
    for (const v of [null, undefined, '', '   ']) expect(chatOpenedDetail(v)).toBeNull();
  });

  it('(T3) ตัดช่องว่างหัวท้าย', () => {
    expect(chatOpenedDetail('  U9  ')?.channel_user_id).toBe('U9');
  });
});

describe('[CHATOPENFRESH] §2 action ไหนทำอะไร — พฤติกรรมล้วน', () => {
  it('⭐⭐ (T4) คลิกการ์ด → ดึงใหม่ พร้อมขอข้าม cooldown ด้วยเหตุผล chat_opened', () => {
    expect(profileRefreshPlan('chat_opened')).toEqual({
      upstream: true,
      trigger: 'chat_opened',
    });
  });

  it('⭐⭐ (T5) ปุ่ม refresh มือ → ดึงใหม่ แต่ **ห้าม** ข้าม cooldown', () => {
    const plan = profileRefreshPlan('manual_refresh');
    expect(plan.upstream).toBe(true);
    /* ถ้าวันไหนบรรทัดนี้แดงเพราะมี trigger โผล่มา = เบรกกดรัว 10 วิตายทั้งระบบ
       โดยไม่มีสัญญาณอะไรบอก · เจ้าของสั่งไว้ตั้งแต่ตอนทำ throttle */
    expect(plan.trigger).toBeUndefined();
  });

  it('⭐ (T6) รับเคส → ของเดิมต้องไม่เปลี่ยน', () => {
    expect(profileRefreshPlan('case_taken')).toEqual({
      upstream: true,
      trigger: 'case_taken',
    });
  });

  it('⭐ (T7) action ที่ไม่รู้จัก / push จาก BE → ไม่ยิงปลายทาง', () => {
    for (const a of ['profile_pushed', '', null, undefined, 42, {}]) {
      expect(profileRefreshPlan(a as unknown)).toEqual({ upstream: false });
    }
  });

});

describe('[CHATOPENFRESH] §4 ต่อสายจริง — ปักด้วยชื่อที่มีที่เดียวทั้ง repo', () => {
  it('⭐⭐ (T14) doOpenTicket ยิง event ตอนคลิกการ์ด และไม่ผูกกับการรับเคส', () => {
    const i = chat.indexOf('const doOpenTicket');
    expect(i).toBeGreaterThan(-1);
    const region = chat.slice(i, chat.indexOf('const openTicket', i));
    expect(region.length).toBeGreaterThan(200);
    expect(region).toContain('setSelectedRoom');       // anchor: ใช่ย่านเปิดห้องจริง
    expect(region).toContain('chatOpenedDetail(');     // ยิงจากตรงนี้
    expect(region).toContain('dispatchEvent');
    /* หัวใจของข้อสั่ง: ห้ามมีเงื่อนไข "เป็นเคสของฉัน/รับแล้ว" มาคุม */
    expect(region).not.toContain('isMyCase');
    expect(region).not.toContain('job_status === 1');
  });

  it('⭐⭐ (T15) PersonalPanel refreshes the member via the tested rule only', () => {
    expect(panel).toContain('profileRefreshPlan(');
    /* ส่ง trigger ที่กฎคำนวณให้ ไม่ใช่ค่าคงที่ที่พิมพ์เอง */
    expect(panel).toContain('refreshRawProfile(memberId, hookId, plan.trigger)');
  });

  it('⭐⭐ (T16) site-rules refresh remains an explicit button action, never chat-open B', () => {
    const handler = panel.indexOf('const doRefresh');
    expect(handler).toBeGreaterThan(-1);
    const around = panel.slice(handler, handler + 600);
    expect(around).toContain('refreshHookSiteRules(hookId)');
    expect(panel).not.toContain('useChatOpenedRefresh(');
  });

  it('⭐ (T17) ticketService รับ trigger ตัวใหม่ และของเดิมไม่หาย', () => {
    const i = svc.indexOf('refreshRawProfile:');
    expect(i).toBeGreaterThan(-1);
    const region = svc.slice(i, i + 400);
    expect(region).toContain("'chat_opened'");
    expect(region).toContain("'case_taken'");
  });
});

describe('[CHATOPENFRESH] §5 PIN — ของเดิมห้ามขยับ', () => {
  it('⭐ (P1) เส้น case_taken เดิมยังอยู่ครบ', () => {
    expect(chat).toContain("action: 'case_taken'");
    expect(chat).toContain('shouldFireCaseTaken(');
  });

  it('⭐ (P2) ปุ่ม refresh มือยังเป็น manual_refresh', () => {
    expect(chat).toContain("action: 'manual_refresh'");
  });

  it('(P3) ชื่อ action ประกาศที่เดียว — TicketChat ห้ามพิมพ์สตริงดิบเอง', () => {
    expect(chat).not.toContain("'chat_opened'");
  });
});
