/**
 * [FEAT-20260824-CLAIMPROFILE] เคสเพิ่งกลายเป็นของแอดมินคนนี้ = ดึงโปรไฟล์ดิบใหม่ทันที
 * ===========================================================================
 * เจ้าของสั่ง: "กดรับเคสเพื่อสนทนา (รับครั้งแรก) · รับเคสต่อ (แย่งจากแอดมินอื่น) ·
 * เปิดเคส (เปิดเคสที่ปิดแล้ว) — ทั้งสามปุ่มนี้เลย ให้ fetch raw profile ใหม่ทันที
 * และ panel ขวาข้อมูลสด ตอนนั้น"
 *
 * แทนที่จะไปแปะ handler ทีละปุ่ม (3 ที่ · ปุ่มที่ 4 ในอนาคตลืมแน่) เราจับที่
 * "รอยต่อ" เดียว: เคสที่เปิดอยู่เปลี่ยนจาก **ไม่ใช่ของเรา → ของเรา**
 * ครอบทั้งสามปุ่มและปุ่มที่ยังไม่มี
 *
 * ⚠️ กับดักที่กฎนี้มีไว้กัน: ถ้าดูแค่ "ตอนนี้เป็นของเราไหม" แล้วยิง
 *    → สลับห้องไปเคสที่เป็นของเราอยู่แล้ว จะยิงทุกครั้งที่สลับห้อง (bug จริง)
 *    ดังนั้นต้องเป็น false→true **ของ ticket id เดียวกัน** เท่านั้น
 *
 * สองครึ่งที่เทสนี้ตรึงไว้:
 *   (ก) กฎ transition (pages/chat/caseTakenRefresh.ts) — pure, ทดสอบตรง ๆ
 *   (ข) ปลายทางที่ PersonalPanel ฟัง — action 'case_taken' ต้องส่ง trigger
 *       'case_taken' ไปด้วย (BE ใช้เป็นเหตุผลเดียวที่ยอมข้าม cooldown 10 วิ)
 *       ส่วนปุ่ม refresh มือ (manual_refresh) ต้อง **ไม่ส่ง** trigger — ยังติด
 *       cooldown เหมือนเดิมทุกประการ
 *
 * revert: ลบไฟล์นี้ + pages/chat/caseTakenRefresh.ts + useEffect ใน TicketChat
 *         + เงื่อนไข 'case_taken' ใน PersonalPanel (marker เดียวกัน)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  shouldFireCaseTaken,
  type CaseOwnership,
} from '../pages/chat/caseTakenRefresh';

// ───────────────────────────────────────────────────────────────────────────
// (ก) กฎ transition — pure
// ───────────────────────────────────────────────────────────────────────────
const own = (ticketId: string | null, isMine: boolean): CaseOwnership => ({ ticketId, isMine });

describe('[FEAT-20260824-CLAIMPROFILE] the not-mine → mine transition', () => {
  it('⭐ รับเคสครั้งแรก: ticket เดิม ไม่ใช่ของเรา → เป็นของเรา = ยิง', () => {
    expect(shouldFireCaseTaken(own('t1', false), own('t1', true))).toBe(true);
  });

  it('⭐ แย่งเคสจากแอดมินอื่น (รับเคสต่อ): ticket เดิม false→true = ยิง', () => {
    // สถานะ 1 อยู่แล้วแต่ admin เป็นคนอื่น → isMine=false; หลังแย่งมา isMine=true
    expect(shouldFireCaseTaken(own('t9', false), own('t9', true))).toBe(true);
  });

  it('⭐ เปิดเคสที่ปิดแล้ว: ticket เดิม false→true = ยิง', () => {
    expect(shouldFireCaseTaken(own('t9', false), own('t9', true))).toBe(true);
  });

  it('⭐⭐ สลับห้องไปเคสที่เป็นของเราอยู่แล้ว = ไม่ยิง (นี่คือ bug ที่กฎนี้กัน)', () => {
    // ก่อนหน้า: ห้อง A ไม่ใช่ของเรา · ตอนนี้: ห้อง B เป็นของเราอยู่แล้ว
    // ถ้าดูแค่ isMine จะเห็น false→true แล้วยิง — ผิด เพราะ B ไม่ได้ "เพิ่งรับ"
    expect(shouldFireCaseTaken(own('roomA', false), own('roomB', true))).toBe(false);
  });

  it('⭐ เคสที่เป็นของเราอยู่แล้วและยังเป็นของเรา = ไม่ยิง', () => {
    expect(shouldFireCaseTaken(own('t1', true), own('t1', true))).toBe(false);
  });

  it('⭐ ของเรา → ไม่ใช่ของเรา (ปิดเคส/ถูกแย่ง) = ไม่ยิง', () => {
    expect(shouldFireCaseTaken(own('t1', true), own('t1', false))).toBe(false);
  });

  it('⭐ ยังไม่ใช่ของเราทั้งคู่ = ไม่ยิง', () => {
    expect(shouldFireCaseTaken(own('t1', false), own('t1', false))).toBe(false);
  });

  it('⭐ ครั้งแรกสุด (ยังไม่เคยมี ticket ที่เลือก) เปิดเคสที่เป็นของเราอยู่แล้ว = ไม่ยิง', () => {
    // เปิดหน้าแล้วคลิกเคสของตัวเองเลย — ไม่ใช่ "เพิ่งรับ"
    expect(shouldFireCaseTaken(own(null, false), own('t1', true))).toBe(false);
  });

  it('⭐ ปิดห้อง (ไม่มีลูกค้าเลือก) = ไม่ยิง', () => {
    expect(shouldFireCaseTaken(own('t1', true), own(null, false))).toBe(false);
    expect(shouldFireCaseTaken(own('t1', false), own(null, true))).toBe(false);
  });

  /* ⚠️⚠️ กับดักที่เกือบพลาด: "เปิดเคส" (reopen) ฝั่ง BE สร้าง ticket **ใบใหม่**
     (buildReopenedTicketCard เอา _id ใหม่มาทับ — ดู test/reopenTicketCard.test.ts)
     ถ้าคีย์ตัวตนด้วย ticket._id ปุ่มเปิดเคสจะเงียบสนิท ทั้งที่เจ้าของสั่งมาชัด
     จึงต้องคีย์ด้วย **ลูกค้า** (line_user_id) — สามปุ่มนั้นลูกค้าคนเดิมเสมอ
     ส่วนการสลับห้องคือคนละลูกค้า จึงยังกันไว้ได้เหมือนเดิม */
  it('⭐⭐ เปิดเคสที่ปิดแล้ว: ticket ได้ _id ใหม่ แต่ลูกค้าคนเดิม = ต้องยิง', () => {
    expect(shouldFireCaseTaken(own('Uaaa', false), own('Uaaa', true))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (ข) ปลายทาง: PersonalPanel ฟัง event แล้วเลือกว่าจะส่ง trigger ไหม
// ───────────────────────────────────────────────────────────────────────────
const refreshRawProfile = vi.fn(() => Promise.resolve(null));
const getRawProfile = vi.fn(() => Promise.resolve(null));

vi.mock('../services/chat', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return {
    ...actual,
    ticketService: {
      ...actual.ticketService,
      getRawProfile: (...a: any[]) => getRawProfile(...(a as [])),
      refreshRawProfile: (...a: any[]) => refreshRawProfile(...(a as [])),
      getLinkCapabilities: () => Promise.resolve(null),
      getStatements: () => Promise.resolve([]),
    },
  };
});

// mount แบบ act จริง (ไม่ตั้งค่านี้ React จะเตือนรัว ๆ ว่า environment ไม่รองรับ act)
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// พจนานุกรมคำแปลกลางยิง fetch ตอน mount — ในเทสไม่มี server ให้ยิง (ECONNREFUSED
// เป็นแค่ noise, โค้ดมี fallback อยู่แล้ว) · stub ไว้ให้ log สะอาด ไม่แตะพฤติกรรม
const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as any).fetch = vi.fn(() =>
    Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve(''), json: () => Promise.resolve(null) } as any),
  );
});
afterEach(() => { (globalThis as any).fetch = realFetch; });

const MEMBER_ID = 'member-mongo-1';
const HOOK_ID = 'hook-1';
const LINE_USER_ID = 'U0123456789abcdef';

const source = {
  line_user_data: { _id: MEMBER_ID, line_user_id: LINE_USER_ID, display_name: 'ลูกค้า A' },
  line_oa_hook_id: HOOK_ID,
  job_status: 1,
  chat_status: 'admin',
  admin_user_data: { _id: 'me', display_name: 'แอดมิน' },
};

const fire = (action: string) =>
  window.dispatchEvent(
    new CustomEvent('tc:customer-profile-updated', {
      detail: { channel_user_id: LINE_USER_ID, action },
    }),
  );

describe('[FEAT-20260824-CLAIMPROFILE] PersonalPanel ปลายทางของ event', () => {
  let root: any;
  let container: HTMLDivElement;

  beforeEach(async () => {
    refreshRawProfile.mockClear();
    getRawProfile.mockClear();
    const React = (await import('react')).default;
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { PersonalPanelNarrow } = await import('../components/profile-panel/ProfilePanel');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await (act as any)(async () => {
      root.render(React.createElement(PersonalPanelNarrow as any, { source, room: null }));
    });
  });

  afterEach(async () => {
    const { act } = await import('react');
    await (act as any)(async () => { root.unmount(); });
    container.remove();
  });

  it('⭐⭐ action case_taken → ยิง refreshRawProfile พร้อม trigger "case_taken" (ข้าม cooldown)', async () => {
    const { act } = await import('react');
    await (act as any)(async () => { fire('case_taken'); });
    expect(refreshRawProfile).toHaveBeenCalledTimes(1);
    expect(refreshRawProfile).toHaveBeenCalledWith(MEMBER_ID, HOOK_ID, 'case_taken');
  });

  it('⭐⭐ ปุ่ม refresh มือ (manual_refresh) ต้อง **ไม่** ส่ง trigger — ยังติด cooldown เดิม', async () => {
    const { act } = await import('react');
    await (act as any)(async () => { fire('manual_refresh'); });
    expect(refreshRawProfile).toHaveBeenCalledTimes(1);
    const args = refreshRawProfile.mock.calls[0] as unknown as any[];
    expect(args[0]).toBe(MEMBER_ID);
    expect(args[1]).toBe(HOOK_ID);
    expect(args[2]).toBeUndefined();
  });

  it('⭐ event ธรรมดา (push จาก BE) ไม่ยิง refresh เลย — โหลดของใน DB พอ', async () => {
    const { act } = await import('react');
    await (act as any)(async () => { fire('linked'); });
    expect(refreshRawProfile).not.toHaveBeenCalled();
  });

  it('⭐ ทั้งสอง action โหลดการ์ดซ้ำหลังยิงเสร็จ (reloadRawProfile)', async () => {
    const { act } = await import('react');
    const before = getRawProfile.mock.calls.length;
    await (act as any)(async () => { fire('case_taken'); });
    await (act as any)(async () => { await Promise.resolve(); });
    expect(getRawProfile.mock.calls.length).toBeGreaterThan(before);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (ค) TicketChat ต้องใช้กฎกลางตัวนี้จริง ๆ (ไม่ใช่เขียนเงื่อนไขซ้ำในหน้า)
// ───────────────────────────────────────────────────────────────────────────
const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('[FEAT-20260824-CLAIMPROFILE] TicketChat ต่อสายเข้ากับกฎกลาง', () => {
  const chat = src('pages/chat/TicketChat.tsx');

  it('⭐ import กฎกลางมาใช้ **และเรียกจริง** ไม่ก็อปเงื่อนไขซ้ำในหน้า', () => {
    expect(chat).toContain("from './caseTakenRefresh'");
    // import อย่างเดียวไม่พอ — ต้องมี "จุดเรียก" ด้วย ไม่งั้นใครมาเขียนเงื่อนไข
    // เองในหน้า (แล้วลืมเทียบ ticketId) เทสนี้จะไม่จับ
    const callSites = chat.split('shouldFireCaseTaken(').length - 1;
    expect(callSites).toBeGreaterThanOrEqual(1);
  });

  it('⭐⭐ คีย์ตัวตนต้องเป็น **ลูกค้า** ไม่ใช่ ticket._id (ไม่งั้นปุ่ม "เปิดเคส" เงียบ)', () => {
    /* reopen สร้าง ticket ใบใหม่ (buildReopenedTicketCard ใส่ _id ใหม่) ถ้า effect
       เทียบ ticket._id จะเห็นเป็น "คนละใบ" แล้วไม่ยิง — ปุ่มที่เจ้าของสั่งมาจะตาย
       เงียบ ๆ · ลูกค้าคนเดิมเสมอในทั้งสามปุ่ม จึงใช้ line_user_id เป็นคีย์ */
    const i = chat.indexOf('shouldFireCaseTaken(');
    expect(i).toBeGreaterThan(-1);
    const start = chat.lastIndexOf('useEffect(', i);
    expect(start).toBeGreaterThan(-1);
    const region = chat.slice(start, i);
    expect(region).toContain('ticketId:');            // anchor: ตัดถูกย่านที่ประกอบ next
    expect(region).toContain('line_user_id');         // คีย์เป็นลูกค้า
    expect(region).not.toContain('selectedTicket?._id');
  });

  it('⭐ ยิง event ช่องทางเดิมด้วย action case_taken และ line_user_id ของสมาชิก', () => {
    const i = chat.indexOf('shouldFireCaseTaken(');
    expect(i).toBeGreaterThan(-1);
    // ตัดเฉพาะย่านของ effect นี้ แล้วยืนยันว่าเราตัดถูกที่จริง ๆ ก่อนค่อย assert
    const region = chat.slice(i, i + 900);
    expect(region).toContain('tc:customer-profile-updated');   // anchor: ต้องเป็นย่านที่ยิง event
    expect(region).toContain("action: 'case_taken'");
    expect(region).toContain('line_user_id');
  });
});
