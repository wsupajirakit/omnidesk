/* [FEAT-20260824-FOLLOWUP] การ์ด "การติดตาม" ในแท็บ "ดำเนินการ"
 * ===========================================================================
 * เจ้าของสั่ง (24/08): 'เพิ่ม card ใหม่ แท็บพับไว้ ใน "ดำเนินการ" ของ member panel ขวา
 * ชื่อ "การติดตาม"' → สามข้อที่ปักไว้ตรงนี้:
 *   1. การ์ดชื่อ "การติดตาม" มีอยู่จริง
 *   2. **พับไว้เป็นค่าเริ่มต้น** (ต่างจากพี่น้อง โน๊ต/ป้าย ที่กางไว้ — เจ้าของสั่งเฉพาะใบนี้)
 *   3. กดหัวการ์ดแล้วกาง / กดซ้ำแล้วพับ (idiom เดียวกับการ์ดพี่น้องในไฟล์ CustomerCards)
 *
 * บวกกับสัญญาของข้อมูล: อ่าน `user_data.config.follow_up.line.*` ซึ่ง**มีจริง**บน
 * room payload อยู่แล้ว (ทางเดียวกับ components/contact/ContactHeaderInfo.tsx)
 * และเวลาที่แสดงต้องเป็น UTC+7 (Asia/Bangkok) ไม่ใช่เวลาเครื่อง
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';

/* การ์ดป้ายกำกับยิง API ตอน mount — mock ให้เงียบ เทสนี้สนใจแค่ว่า
   "การติดตาม" ถูกแขวนมาด้วยหรือเปล่า ไม่ได้ทดสอบตัวป้ายกำกับ */
vi.mock('../services/chat', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const empty = () => Promise.resolve({ data: [] });
  return {
    ...mod,
    chatService: {
      ...(mod as any).chatService,
      listTags: empty, popularTags: empty, suggestTags: empty,
    },
  };
});

import { FollowUpCard } from '../components/member/follow-up';
import { CustomerTags } from '../components/member/CustomerCards';

/** ห้องแชทเปล่า — ลูกค้าที่ยังไม่เคยถูกติดตามเลย */
const bareRoom = (): any => ({ _id: 'r1', user_data: { display_name: 'judy' } });

/** ห้องแชทที่ลูกค้าถือ stamp ติดตามอยู่ */
const stampedRoom = (line: Record<string, unknown>): any => ({
  _id: 'r1',
  user_data: { display_name: 'judy', config: { follow_up: { line } } },
});

describe('[FOLLOWUP] การ์ด "การติดตาม" — มีจริง และพับไว้เป็นค่าเริ่มต้น', () => {
  it('แสดงชื่อการ์ด "การติดตาม"', () => {
    const t = render(<FollowUpCard room={bareRoom()} />);
    expect(t.container.textContent).toContain('การติดตาม');
  });

  /* ข้อนี้คือหัวใจของคำสั่งเจ้าของ ("แท็บพับไว้") — เนื้อในต้องไม่ถูก render
     ตอนเปิดหน้ามา ไม่ใช่แค่ซ่อนด้วย css */
  it('พับไว้เป็นค่าเริ่มต้น — เนื้อในยังไม่ถูก render', () => {
    const t = render(<FollowUpCard room={stampedRoom({ notice_deposit_at: '2026-08-22T16:30:00.000Z' })} />);
    expect(t.container.textContent).not.toContain('ติดตามฝาก');
    expect(t.getByRole('button', { name: /การติดตาม/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('กดหัวการ์ด = กาง แล้วกดซ้ำ = พับกลับ', () => {
    const t = render(<FollowUpCard room={stampedRoom({ notice_deposit_at: '2026-08-22T16:30:00.000Z' })} />);
    const head = t.getByRole('button', { name: /การติดตาม/ });

    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(t.container.textContent).toContain('ติดตามฝาก');

    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(t.container.textContent).not.toContain('ติดตามฝาก');
  });
});

/* ==== การ์ดถูก "แขวน" เข้าแท็บดำเนินการจริงหรือไม่ ====
   ⚠️ ข้อนี้ขาดไม่ได้: สามข้อบนสุด render <FollowUpCard> ตรง ๆ จึงยังเขียวอยู่
   แม้จะถอดการ์ดออกจาก CustomerCards ไปแล้ว (พิสูจน์ด้วย mutation: ลบบรรทัด
   <FollowUpCard room={room}/> ทิ้ง → 12/12 ยังผ่าน = ไม่มีใครจับได้)
   ⇒ ต้องมีข้อที่ผูกกับ "จุดแขวน" ไม่ใช่แค่ตัวการ์ด

   ทำไมผูกกับ <CustomerTags>: แท็บ "ดำเนินการ" ประกอบที่ pages/chat/TicketChat.tsx
   (OperationsPanel) และ pages/chat/Contact.tsx ซึ่ง render การ์ดชุดนี้อยู่
   การ์ดใหม่แขวนกับ CustomerTags จึงตามไปโผล่ครบทั้งสองหน้าพร้อมกัน */
/* ⚠️ เคสนี้ถูก **พลิก** (ไม่ได้ลบ) เมื่อ 24/08/2026 — เดิมยืนยันว่า render
   <CustomerTags> แล้วต้องได้ "การติดตาม" ติดมาด้วย เพราะรอบแรกการ์ดถูกแขวน
   ไว้ **ข้างใน** CustomerTags · นั่นคือการเอาการ์ดไปซ้อนในการ์ดอื่น (ยัดมั่ว)
   ใครลบการ์ดป้ายกำกับก็จะลบการติดตามไปด้วยโดยไม่ตั้งใจ
   ⇒ ย้ายมาแขวนเป็น **พี่น้อง** ที่จุดประกอบจริงทั้ง 2 หน้าแทน
      (pages/chat/TicketChat.tsx · pages/chat/Contact.tsx)
   เคสใหม่จึงตรึง "ถูกแขวนที่จุดประกอบจริงทั้งสองหน้า" + "ไม่ซ้อนใน CustomerTags" */
describe('[FOLLOWUP] การ์ดถูกแขวนเป็นพี่น้องที่จุดประกอบจริง ไม่ซ้อนในการ์ดอื่น', () => {
  const stripComments = (src: string) =>
    // ⚠️ ลำดับสำคัญ: ตัด // ก่อน /* */ — ถ้าสลับกัน `/*` ที่อยู่ในคอมเมนต์ //
    //    จะเปิดบล็อกยาวไปกลืนโค้ดจริง (เคยพลาดมาแล้วในรอบก่อน)
    src.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

  const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('⭐ CustomerTags ต้อง **ไม่** render การติดตามอยู่ข้างในอีกแล้ว', async () => {
    const t = render(<CustomerTags room={stampedRoom({ notice_deposit_at: '2026-08-22T16:30:00.000Z' })} />);
    await waitFor(() => expect(t.container.textContent).toContain('ป้ายกำกับลูกค้า'));
    expect(t.container.textContent).not.toContain('การติดตาม');
  });

  /* ⚠️ ผ่อนจาก "ไบต์ตรงตัว" เป็น "แขวนอยู่จริงและได้ room ตัวเดียวกัน" (25/08)
     เดิมปัก `<CustomerTags room={room} />` เป๊ะ ๆ · [FIX-20260825-PANELREFRESH]
     เติม `key={panelCardKey(...)}` ให้การ์ดเพื่อให้ remount ตอนกดรีเฟรช
     ⇒ สตริงเดิมไม่ตรงแล้ว แต่ **เจตนาของเคสนี้ยังจริงทุกประการ**: การ์ดยังถูก
     แขวนที่จุดประกอบนี้และยังรับ room ตัวเดียวกับพี่น้อง
     ⚠️ ไม่ผ่อนเป็นแค่ `toContain('<CustomerTags')` เพราะนั่นจะผ่านแม้มีคนเปลี่ยน
        prop ไปเป็นห้องอื่น ซึ่งเป็นความพังที่เคสนี้มีไว้จับ */
  it('⭐⭐ ถูกแขวนที่ TicketChat (แท็บดำเนินการ) จริง', () => {
    const src = stripComments(ticketChatSource());
    for (const card of ['<CustomerTags', '<FollowUpCard']) {
      const at = src.indexOf(card);
      expect(at, `${card} ยังถูกแขวนอยู่ไหม`).toBeGreaterThan(-1);
      const own = src.slice(at, src.indexOf('/>', at));
      expect(own, `${card} ต้องรับ room ตัวเดียวกับพี่น้อง`).toContain('room={room}');
    }
  });

  it('⭐⭐ ถูกแขวนที่ Contact (แท็บดำเนินการหน้า Contact) จริง', () => {
    const src = read('pages/chat/Contact.tsx');
    expect(src).toContain('<CustomerTags');                  // anchor
    expect(src).toContain('<FollowUpCard');
  });

  it('⭐ พับไว้เป็นค่าเริ่มต้น (render ตรง ๆ)', () => {
    const t = render(<FollowUpCard room={stampedRoom({ notice_deposit_at: '2026-08-22T16:30:00.000Z' })} />);
    expect(t.getByRole('button', { name: /การติดตาม/ })).toHaveAttribute('aria-expanded', 'false');
    expect(t.container.textContent).not.toContain('ติดตามฝาก');
  });
});

describe('[FOLLOWUP] อ่าน stamp จาก config.follow_up.line + แสดงเป็นเวลาไทย (UTC+7)', () => {
  /* ⚠️ ต้องบังคับ timezone ของกระบวนการเป็น UTC ก่อนบล็อกนี้ — ไม่ใช่พิธีกรรม:
     เครื่องเจ้าของตั้งเป็น Asia/Bangkok อยู่แล้ว ถ้าไม่ปักตรงนี้ การลบ
     `timeZone: 'Asia/Bangkok'` ออกจาก followStampThai จะ**ยังเขียวอยู่**
     (พิสูจน์ด้วย mutation แล้ว: ลบ timeZone → 12/12 ผ่าน = เทสไม่จับ)
     ปักเป็น UTC แล้วเลข 23:30 จะเกิดได้ทางเดียวคือโค้ดแปลง +07:00 เอง */
  const realTZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = realTZ; });

  const open = (room: any) => {
    const t = render(<FollowUpCard room={room} />);
    fireEvent.click(t.getByRole('button', { name: /การติดตาม/ }));
    return t;
  };

  /* 16:30Z = 23:30 ที่กรุงเทพ — ห่าง 7 ชม. ถ้าเผลอ render เป็นเวลาเครื่อง/UTC
     ข้อนี้จะแดงทันที (นี่คือเหตุผลที่ปักเลข 23:30 ไว้ ไม่ใช่แค่เช็คว่ามีตัวเลข) */
  it('แปลง UTC เป็นเวลากรุงเทพ ไม่ใช่เวลาเครื่อง', () => {
    const t = open(stampedRoom({ notice_deposit_at: '2026-08-22T16:30:00.000Z' }));
    expect(t.container.textContent).toContain('23:30');
    expect(t.container.textContent).toContain('22/08/2026');
  });

  /* ⚠️ เคสนี้ถูก **พลิก** (ไม่ได้ลบ) 24/08/2026 — เดิมปักไว้ว่า "ครบทั้งสี่"
     เจ้าของสั่งตัดเหลือ 2 แถวบน หลังพบว่าป้าย "ติดตามสลิป" สื่อผิด:
     `notice_payment_at` คือการ์ด ALL OFF-TIME / ALL DISABLE (เคส E/F)
     ไม่ใช่การติดตามสลิป · `request_reg_at` ถูกตัดพร้อมกัน
     เคสใหม่จึงปักทั้ง "สองใบที่เหลือต้องมา" และ "สองใบที่ตัดต้องไม่โผล่" */
  it('⭐⭐ แสดงเฉพาะ 2 stamp ที่เจ้าของสั่งให้เหลือ', () => {
    const t = open(stampedRoom({
      notice_deposit_at: '2026-08-22T16:30:00.000Z',
      notice_withdraw_at: '2026-08-23T01:00:00.000Z',
      notice_payment_at: '2026-08-24T02:15:00.000Z',
      request_reg_at: '2026-08-20T05:00:00.000Z',
    }));
    const text = t.container.textContent || '';
    expect(text).toContain('ติดตามฝาก');
    expect(text).toContain('ติดตามถอน');
    // ⛔ ตัดออกแล้ว — ต้องไม่โผล่แม้ค่าจะมีอยู่ใน DB ครบทั้งสี่ใบ
    expect(text).not.toContain('ติดตามสลิป');
    expect(text).not.toContain('ชวนลงทะเบียน');
    expect(text).not.toContain('เคยได้รับแจ้งเตือนเรื่องการชำระ');
    expect(text).not.toContain('n/a');
  });

  /* ⚠️ [UI-20260825-REGROWS] เคสนี้ถูก **พลิก** ไม่ใช่ลบ — เดิมคาดว่า 2
     เพราะ 24/08 เจ้าของสั่งซ่อนทั้ง `notice_payment_at` และ `request_reg_at`
     25/08 เจ้าของสั่งให้ `request_reg_at` **กลับมาแสดง** ในรูปแบบใหม่: เป็น
     "แถวเตือน" ที่มีเงื่อนไข (ต้องยังไม่ผูกบัญชีด้วย) ไม่ใช่แถวประวัติเฉย ๆ
     ⇒ ห้องนี้ไม่มี `raw_profile_data` และมี `request_reg_at` ⇒ นับเป็น 3
     สิ่งที่เคสนี้ยังทำหน้าที่เดิม: กันไม่ให้ `notice_payment_at` ถูกนับกลับมา
     ซึ่งยังถูกซ่อนอยู่ตามคำสั่ง 24/08 ที่ไม่ถูกยกเลิก */
  it('⭐⭐ ตัวนับ = 2 แถวประวัติ + แถวเตือนที่เข้าเงื่อนไข (payment ยังไม่ถูกนับ)', () => {
    const t = open(stampedRoom({
      notice_deposit_at: '2026-08-22T16:30:00.000Z',
      notice_withdraw_at: '2026-08-23T01:00:00.000Z',
      notice_payment_at: '2026-08-24T02:15:00.000Z',
      request_reg_at: '2026-08-20T05:00:00.000Z',
    }));
    const txt = t.container.textContent || '';
    expect(txt).toContain('3 รายการ');
    expect(txt).not.toContain('4 รายการ');
    // notice_payment_at ยังต้องไม่โผล่ ทั้งป้ายและตัวนับ
    expect(txt).not.toContain('เคยได้รับแจ้งเตือนเรื่องการชำระ');
  });

  /* ค่าที่ใช้ไม่ได้ต้องกลายเป็น n/a ไม่ใช่ "Invalid Date" — ชุดเดียวกับที่
     followerSwitchAndStamps ปักไว้ให้ ContactHeaderInfo */
  it.each([
    ['ไม่มี key เลย', {}],
    ['null', { notice_deposit_at: null }],
    ['สตริงว่าง', { notice_deposit_at: '' }],
    ['แปลงเป็นวันที่ไม่ได้', { notice_deposit_at: 'not-a-date' }],
  ])('%s → n/a (ไม่ใช่ Invalid Date)', (_label, line) => {
    const t = open(stampedRoom(line as Record<string, unknown>));
    expect(t.container.textContent).toContain('n/a');
    expect(t.container.textContent).not.toContain('Invalid Date');
  });

  it('รับ Date object ได้เหมือนกับสตริง ISO', () => {
    const t = open(stampedRoom({ notice_deposit_at: new Date('2026-08-22T16:30:00.000Z') }));
    expect(t.container.textContent).toContain('23:30');
  });

  it('ลูกค้าที่ยังไม่เคยถูกติดตาม — การ์ดยังอยู่ ไม่พัง และบอกสถานะว่าง', () => {
    const t = open(bareRoom());
    expect(t.container.textContent).toContain('การติดตาม');
    expect(t.container.textContent).toContain('n/a');
  });

  it('room = null ก็ต้องไม่พัง', () => {
    const t = render(<FollowUpCard room={null} />);
    expect(t.container.textContent).toContain('การติดตาม');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   [FEAT-20260825-ABANDONSTAT] แถวเตือน "ชวนลงทะเบียนแล้วยังไม่ทำ"
   เจ้าของ 25/08: *"panel ขวา ตรงบริเวณการติดตาม เพิ่ม stat — ถ้า member
   no profile + ชวนลงทะเบียนแล้วยังไม่ทำ มีค่า date จะแสดง label
   ชวนลงทะเบียนแล้วยังไม่ทำ : <datetime>"*

   ⚠️ เจ้าของสั่งเพิ่มด้วยว่า *"config.follow_up.line.request_reg_at จะตรงไม่ถูก
   เคลียร์ไม่ว่าจุดใด · ถ้าเช็คว่าลงทะเบียนไปแล้วหรือยัง ให้เช็คเพิ่มจาก
   raw profile data"* ⇒ ตัวชี้ขาดว่า "ลงทะเบียนแล้ว" คือ `raw_profile_data`
   ไม่ใช่ stamp ใด ๆ ในถุง follow_up (stamp พวกนั้นเป็นบันทึกถาวร ไม่ได้บอกสถานะ)
   ══════════════════════════════════════════════════════════════════════════ */
import {
  hasRawProfile,
  showAbandonAlert,
  ABANDON_ROW,
} from '../components/member/follow-up/followStamps';

const roomWith = (opts: { profile?: unknown; abandon?: unknown }): any => ({
  _id: 'r1',
  user_data: {
    display_name: 'judy',
    ...(opts.profile === undefined ? {} : { raw_profile_data: opts.profile }),
    config: { follow_up: { line: { abandon_trigger_at: opts.abandon } } },
  },
});

describe('[ABANDONSTAT] §1 "ลงทะเบียนแล้วหรือยัง" ตัดสินจาก raw_profile_data', () => {
  it('⭐⭐ มี raw_profile_data = ลงทะเบียนแล้ว', () => {
    expect(hasRawProfile(roomWith({ profile: { data: { name: 'a' } } }))).toBe(true);
  });

  it('⭐⭐ ไม่มี / null / ว่าง = ยังไม่ลงทะเบียน', () => {
    expect(hasRawProfile(roomWith({}))).toBe(false);
    expect(hasRawProfile(roomWith({ profile: null }))).toBe(false);
    expect(hasRawProfile(roomWith({ profile: {} }))).toBe(false);
    expect(hasRawProfile(null as any)).toBe(false);
  });
});

describe('[ABANDONSTAT] §2 แถวเตือนโผล่เมื่อไหร่ — ต้องครบสองเงื่อนไข', () => {
  const DATE = '2026-08-20T13:32:52.000Z';

  it('⭐⭐ ยังไม่ลงทะเบียน + มีวันที่ชวน → แสดง', () => {
    expect(showAbandonAlert(roomWith({ abandon: DATE }))).toBe(true);
  });

  it('⭐⭐ ลงทะเบียนแล้ว แม้ยังมีวันที่ค้างอยู่ → **ไม่**แสดง', () => {
    /* ธงถูกเคลียร์ตอนสมัครอยู่แล้วทั้งสองเส้นทาง แต่ถ้าเส้นไหนพลาด/ค้าง
       จอต้องไม่ไปกล่าวหาลูกค้าที่สมัครแล้วว่า "ยังไม่ทำ" */
    expect(
      showAbandonAlert(roomWith({ profile: { data: { name: 'a' } }, abandon: DATE })),
    ).toBe(false);
  });

  it('⭐ ยังไม่ลงทะเบียน แต่ไม่เคยถูกชวน → ไม่แสดง', () => {
    expect(showAbandonAlert(roomWith({}))).toBe(false);
    expect(showAbandonAlert(roomWith({ abandon: null }))).toBe(false);
    expect(showAbandonAlert(roomWith({ abandon: '' }))).toBe(false);
  });

  it('⭐ วันที่เสีย → ไม่แสดง (ดีกว่าโชว์ Invalid Date ให้แอดมินอ่าน)', () => {
    expect(showAbandonAlert(roomWith({ abandon: 'ไม่ใช่วันที่' }))).toBe(false);
  });
});

describe('[ABANDONSTAT] §3 การ์ดแสดงแถวนี้จริงพร้อมเวลาไทย', () => {
  const DATE = '2026-08-20T13:32:52.000Z';   // = 20/08/2026 20:32 กรุงเทพ

  it('⭐⭐ กางการ์ดแล้วเห็นป้าย + เวลา', () => {
    const { getByText, container } = render(
      <FollowUpCard room={roomWith({ abandon: DATE })} />,
    );
    fireEvent.click(getByText('การติดตาม'));
    const txt = container.textContent || '';
    expect(txt).toContain(ABANDON_ROW.label);
    expect(txt).toContain('20/08/2026 20:32');
  });

  it('⭐⭐ ลงทะเบียนแล้ว → ไม่มีป้ายนี้ในการ์ด', () => {
    const { getByText, container } = render(
      <FollowUpCard room={roomWith({ profile: { data: { n: 1 } }, abandon: DATE })} />,
    );
    fireEvent.click(getByText('การติดตาม'));
    expect(container.textContent || '').not.toContain(ABANDON_ROW.label);
  });

  it('⭐ แถวนี้ถูกนับรวมในตัวเลข "N รายการ" บนหัวการ์ดด้วย', () => {
    const { container } = render(<FollowUpCard room={roomWith({ abandon: DATE })} />);
    // พับอยู่ก็ต้องนับแล้ว — แอดมินต้องเห็นว่ามีของโดยไม่ต้องกาง
    expect(container.textContent || '').toContain('1 รายการ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   [UI-20260825-REGROWS] แถวเตือนใบที่สอง: `request_reg_at`
   ป้าย "ขอข้อมูลลูกค้าแล้วแต่ยังไม่ลงทะเบียน"

   ⭐ ป้าย**เขียนเงื่อนไขไว้ในตัวมันเอง** — คำว่า "แต่ยังไม่ลงทะเบียน" จะเป็นจริง
   ก็ต่อเมื่อเช็ค `raw_profile_data` ประกอบ · `request_reg_at` เป็น RECORD ที่
   ไม่มีใครลบ ⇒ ถ้าโชว์ตามการมี stamp อย่างเดียว ลูกค้าที่สมัครไปแล้วเมื่อเดือนก่อน
   ก็จะยังโชว์แถวที่บอกว่าเขายังไม่สมัคร แล้วแอดมินจะไปทวงซ้ำ
   ⇒ ใช้กติกาเดียวกับแถว abandon เป๊ะ (สองเงื่อนไข)
   ══════════════════════════════════════════════════════════════════════════ */
import { ALERT_ROWS, alertRowsFor, REQUEST_REG_ROW, CUSTOMER_HELPER_ROW } from '../components/member/follow-up/followStamps';

const roomWith2 = (o: { profile?: unknown; abandon?: unknown; reqreg?: unknown }): any => ({
  _id: 'r2',
  user_data: {
    display_name: 'judy',
    ...(o.profile === undefined ? {} : { raw_profile_data: o.profile }),
    config: {
      follow_up: {
        line: { abandon_trigger_at: o.abandon, request_reg_at: o.reqreg },
      },
    },
  },
});

const D = '2026-08-20T13:32:52.000Z';   // = 20/08/2026 20:32 กรุงเทพ

describe('[REGROWS] §1 แถวเตือนทั้งชุดใช้กติกาเดียวกัน', () => {
  /* ⚠️ [FEAT-20260825-HELPERTRIGGER] โตจากสองเป็นสาม — พลิก ไม่ลบ
     `customer_helper_trigger_at` เข้ามาเป็นใบที่สาม พร้อมกับที่ฝั่ง BE เริ่ม
     ประทับเวลาตอนเสนอการ์ดลงทะเบียน · ลิสต์นี้แดง = เทสทำงานถูก
     โตได้แต่ต้องจดเหตุผลไว้ตรงนี้เสมอ */
  it('⭐ (T1) มีสามแถว และป้ายตรงตามที่สั่ง', () => {
    expect(ALERT_ROWS.map((r) => r.key)).toEqual([
      'abandon_trigger_at',
      'request_reg_at',
      'customer_helper_trigger_at',
    ]);
    expect(REQUEST_REG_ROW.label).toBe('ขอข้อมูลลูกค้าแล้วแต่ยังไม่ลงทะเบียน');
    expect(CUSTOMER_HELPER_ROW.label).toBe('ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน');
  });

  it('⭐⭐ (T1b) ใบที่สามใช้กติกาเดียวกัน — ผูกข้อมูลแล้วต้องไม่โชว์', () => {
    const withHelper = (profile?: unknown): any => ({
      _id: 'r9',
      user_data: {
        ...(profile === undefined ? {} : { raw_profile_data: profile }),
        config: {
          follow_up: { line: { customer_helper_trigger_at: '2026-08-20T13:32:52.000Z' } },
        },
      },
    });
    expect(alertRowsFor(withHelper()).map((r) => r.key)).toEqual([
      'customer_helper_trigger_at',
    ]);
    expect(alertRowsFor(withHelper({ data: { n: 1 } }))).toEqual([]);
  });

  it('⭐⭐ (T2) ยังไม่ผูกบัญชี → โชว์เฉพาะใบที่มี stamp จริง', () => {
    expect(alertRowsFor(roomWith2({ reqreg: D })).map((r) => r.key)).toEqual([
      'request_reg_at',
    ]);
    expect(alertRowsFor(roomWith2({ abandon: D })).map((r) => r.key)).toEqual([
      'abandon_trigger_at',
    ]);
    expect(alertRowsFor(roomWith2({ abandon: D, reqreg: D })).map((r) => r.key)).toEqual([
      'abandon_trigger_at',
      'request_reg_at',
    ]);
  });

  it('⭐⭐ (T3) ผูกบัญชีแล้ว → ไม่โชว์สักใบ แม้ stamp จะยังอยู่ครบ', () => {
    /* `request_reg_at` ไม่มีใครลบ ⇒ ถ้าไม่เช็คโปรไฟล์ แถวนี้จะค้างตลอดชีวิตลูกค้า */
    const room = roomWith2({ profile: { data: { n: 1 } }, abandon: D, reqreg: D });
    expect(alertRowsFor(room)).toEqual([]);
  });

  it('⭐ (T4) ไม่มี stamp เลย → ไม่โชว์', () => {
    expect(alertRowsFor(roomWith2({}))).toEqual([]);
  });
});

describe('[REGROWS] §2 การ์ดแสดงจริง', () => {
  it('⭐⭐ (T5) กางแล้วเห็นทั้งสองป้าย พร้อมเวลาไทย', () => {
    const { getByText, container } = render(
      <FollowUpCard room={roomWith2({ abandon: D, reqreg: D })} />,
    );
    fireEvent.click(getByText('การติดตาม'));
    const txt = container.textContent || '';
    expect(txt).toContain('เคยถูกชวนให้ลงทะเบียน แต่ยังไม่ลงทะเบียน');
    expect(txt).toContain('ขอข้อมูลลูกค้าแล้วแต่ยังไม่ลงทะเบียน');
    expect(txt).toContain('20/08/2026 20:32');
  });

  it('⭐⭐ (T6) ผูกบัญชีแล้ว → ไม่มีป้ายเตือนสักใบในการ์ด', () => {
    const { getByText, container } = render(
      <FollowUpCard room={roomWith2({ profile: { data: { n: 1 } }, abandon: D, reqreg: D })} />,
    );
    fireEvent.click(getByText('การติดตาม'));
    const txt = container.textContent || '';
    expect(txt).not.toContain('เคยถูกชวนให้ลงทะเบียน');
    expect(txt).not.toContain('ขอข้อมูลลูกค้าแล้ว');
  });

  it('⭐ (T7) ตัวนับบนหัวการ์ดรวมแถวเตือนทั้งสองใบ', () => {
    const { container } = render(<FollowUpCard room={roomWith2({ abandon: D, reqreg: D })} />);
    expect(container.textContent || '').toContain('2 รายการ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   [UI-20260825-COLPEEK] ปุ่มรูปตา — กดแล้วเห็นชื่อคอลัมน์จริงในฐานข้อมูล
   ป้ายบนการ์ดเป็นภาษาไทย แต่เวลาไปตั้งเงื่อนไข broadcast หรือคิวรี่ฐานต้องใช้
   ชื่อคอลัมน์ ⇒ ให้ดูได้จากที่เดียวกัน ไม่ต้องเดาหรือไปเปิดโค้ด
   ══════════════════════════════════════════════════════════════════════════ */
import { columnPath } from '../components/member/follow-up/followStamps';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

describe('[COLPEEK] ปุ่มตาโชว์ชื่อคอลัมน์', () => {
  const roomAll = (): any => ({
    _id: 'r3',
    user_data: {
      display_name: 'judy',
      config: {
        follow_up: {
          line: {
            notice_deposit_at: '2026-08-22T16:30:00.000Z',
            abandon_trigger_at: '2026-08-20T13:32:52.000Z',
          },
        },
      },
    },
  });

  const openCard = () => {
    const t = render(<FollowUpCard room={roomAll()} />);
    fireEvent.click(t.getByText('การติดตาม'));
    return t;
  };

  it('⭐ (T1) ปิดไว้เป็นค่าเริ่มต้น — ไม่มี path ยาว ๆ กวนตาตอนเปิดการ์ด', () => {
    const t = openCard();
    expect(t.container.textContent || '').not.toContain('config.follow_up.line');
  });

  it('⭐⭐ (T2) กดแล้วเห็นชื่อคอลัมน์เต็ม ทั้งแถวประวัติและแถวเตือน', () => {
    const t = openCard();
    fireEvent.click(t.getByLabelText('แสดงชื่อคอลัมน์ในฐานข้อมูล'));
    const txt = t.container.textContent || '';
    expect(txt).toContain(columnPath('notice_deposit_at' as never));
    expect(txt).toContain(columnPath('abandon_trigger_at' as never));
  });

  it('⭐⭐ (T3) กดปุ่มตาแล้วการ์ด **ต้องไม่พับ** (ปุ่มซ้อนอยู่ในแถบพับ/กาง)', () => {
    /* แถบหัวการ์ดทั้งแถบเป็นปุ่มพับ/กาง ⇒ ถ้าไม่ stopPropagation กดดูชื่อคอลัมน์
       ทีเดียวการ์ดจะปิดไปด้วย แล้วดูอะไรไม่ทันเลย — บั๊กที่เจอตอนใช้จริงเท่านั้น */
    const t = openCard();
    expect(t.container.textContent || '').toContain('ติดตามฝาก');   // กางอยู่
    fireEvent.click(t.getByLabelText('แสดงชื่อคอลัมน์ในฐานข้อมูล'));
    expect(t.container.textContent || '').toContain('ติดตามฝาก');   // ยังกางอยู่
    expect(t.container.textContent || '').toContain('config.follow_up.line');
  });

  it('⭐ (T4) กดซ้ำ = ซ่อนกลับ', () => {
    const t = openCard();
    const eye = t.getByLabelText('แสดงชื่อคอลัมน์ในฐานข้อมูล');
    fireEvent.click(eye);
    expect(t.container.textContent || '').toContain('config.follow_up.line');
    fireEvent.click(eye);
    expect(t.container.textContent || '').not.toContain('config.follow_up.line');
  });

  it('⭐ (T5) path ที่โชว์เอาไปคิวรี่ได้จริง — dotted เต็ม ไม่ใช่ชื่อ leaf', () => {
    expect(columnPath('request_reg_at' as never)).toBe(
      'config.follow_up.line.request_reg_at',
    );
  });
});
